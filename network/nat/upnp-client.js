// Module: UPnP Client
// Description: UPnP/IGD client for automatic port mapping.
// File: network/nat/upnp-client.js

import dgram from 'dgram';
import http from 'http';
import { EventEmitter } from 'events';

/**
 * UPnP Client Options
 */
const DEFAULT_OPTIONS = {
  searchTimeout: 5000,
  searchInterval: 1000,
  portMappingLease: 3600, // 1 hour
  description: 'NewZoneCore UPnP Mapping'
};

/**
 * UPnP Events
 */
export const UPnPEvents = {
  GATEWAY_FOUND: 'gateway_found',
  MAPPING_ADDED: 'mapping_added',
  MAPPING_REMOVED: 'mapping_removed',
  ERROR: 'error'
};

/**
 * UPnPClient class - handles UPnP/IGD port mapping
 */
export class UPnPClient extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // Gateway info
    this._gateway = null;
    this._externalIP = null;
    
    // Active mappings
    this._mappings = new Map();
    
    // State
    this._isSearching = false;
  }

  /**
   * Search for UPnP gateway
   */
  async discoverGateway() {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('UPnP gateway discovery timeout'));
      }, this.options.searchTimeout);
      
      // M-SEARCH message
      const searchMessage = [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'MAN: "ssdp:discover"',
        'MX: 3',
        'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1',
        '',
        ''
      ].join('\r\n');
      
      socket.on('message', (msg, rinfo) => {
        const response = msg.toString();
        
        // Check for IGD device
        if (response.includes('InternetGatewayDevice') || 
            response.includes('WANIPConnection') ||
            response.includes('WANPPPConnection')) {
          
          // Extract location URL
          const locationMatch = response.match(/LOCATION:\s*(.+)/i);
          if (locationMatch) {
            const location = locationMatch[1].trim();
            
            clearTimeout(timeout);
            socket.close();
            
            this._gateway = {
              address: rinfo.address,
              location
            };
            
            this.emit(UPnPEvents.GATEWAY_FOUND, this._gateway);
            resolve(this._gateway);
          }
        }
      });
      
      socket.on('error', (err) => {
        clearTimeout(timeout);
        socket.close();
        reject(err);
      });
      
      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(
          searchMessage,
          1900,
          '239.255.255.250',
          (err) => {
            if (err) {
              clearTimeout(timeout);
              socket.close();
              reject(err);
            }
          }
        );
      });
    });
  }

  /**
   * Get gateway device description
   */
  async getDeviceDescription() {
    if (!this._gateway) {
      await this.discoverGateway();
    }
    
    return new Promise((resolve, reject) => {
      const url = new URL(this._gateway.location);
      
      const req = http.request({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'GET',
        timeout: 5000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Device description timeout'));
      });
      
      req.end();
    });
  }

  /**
   * Get external IP address
   */
  async getExternalIP() {
    if (!this._gateway) {
      await this.discoverGateway();
    }
    
    const soapAction = 'urn:schemas-upnp-org:service:WANIPConnection:1#GetExternalIPAddress';
    const soapBody = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetExternalIPAddress xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1"></u:GetExternalIPAddress></s:Body></s:Envelope>';
    
    const response = await this._sendSOAPRequest(soapAction, soapBody);
    
    // Extract IP from response
    const ipMatch = response.match(/<NewExternalIPAddress>(.+?)<\/NewExternalIPAddress>/);
    if (ipMatch) {
      this._externalIP = ipMatch[1];
      return this._externalIP;
    }
    
    throw new Error('Failed to get external IP');
  }

  /**
   * Add port mapping
   */
  async addPortMapping(internalPort, externalPort, options = {}) {
    if (!this._gateway) {
      await this.discoverGateway();
    }
    
    if (!this._externalIP) {
      try {
        await this.getExternalIP();
      } catch (e) {
        // Continue without external IP
      }
    }
    
    const protocol = options.protocol || 'TCP';
    const description = options.description || this.options.description;
    const leaseDuration = options.leaseDuration || this.options.portMappingLease;
    const internalClient = options.internalClient || await this._getLocalIP();
    
    const soapAction = 'urn:schemas-upnp-org:service:WANIPConnection:1#AddPortMapping';
    const soapBody = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:AddPortMapping xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">
      <NewRemoteHost></NewRemoteHost>
      <NewExternalPort>${externalPort}</NewExternalPort>
      <NewProtocol>${protocol}</NewProtocol>
      <NewInternalPort>${internalPort}</NewInternalPort>
      <NewInternalClient>${internalClient}</NewInternalClient>
      <NewEnabled>1</NewEnabled>
      <NewPortMappingDescription>${description}</NewPortMappingDescription>
      <NewLeaseDuration>${leaseDuration}</NewLeaseDuration>
    </u:AddPortMapping>
  </s:Body>
</s:Envelope>`;
    
    await this._sendSOAPRequest(soapAction, soapBody);
    
    const mapping = {
      internalPort,
      externalPort,
      protocol,
      internalClient,
      description,
      leaseDuration,
      createdAt: Date.now()
    };
    
    this._mappings.set(`${externalPort}:${protocol}`, mapping);
    
    this.emit(UPnPEvents.MAPPING_ADDED, mapping);
    
    return mapping;
  }

  /**
   * Remove port mapping
   */
  async removePortMapping(externalPort, protocol = 'TCP') {
    if (!this._gateway) {
      await this.discoverGateway();
    }
    
    const soapAction = 'urn:schemas-upnp-org:service:WANIPConnection:1#DeletePortMapping';
    const soapBody = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:DeletePortMapping xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">
      <NewRemoteHost></NewRemoteHost>
      <NewExternalPort>${externalPort}</NewExternalPort>
      <NewProtocol>${protocol}</NewProtocol>
    </u:DeletePortMapping>
  </s:Body>
</s:Envelope>`;
    
    await this._sendSOAPRequest(soapAction, soapBody);
    
    const key = `${externalPort}:${protocol}`;
    const mapping = this._mappings.get(key);
    this._mappings.delete(key);
    
    this.emit(UPnPEvents.MAPPING_REMOVED, mapping);
    
    return true;
  }

  /**
   * Get all active mappings
   */
  getMappings() {
    return Array.from(this._mappings.values());
  }

  /**
   * Check if UPnP is available
   */
  async isAvailable() {
    try {
      await this.discoverGateway();
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Send SOAP request to gateway
   */
  async _sendSOAPRequest(soapAction, soapBody) {
    const url = new URL(this._gateway.location);
    
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: url.hostname,
        port: url.port || 80,
        path: '/ctl/IPConn', // Common control URL
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(soapBody),
          'SOAPAction': `"${soapAction}"`
        },
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`SOAP request failed: ${res.statusCode}`));
          }
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('SOAP request timeout'));
      });
      
      req.write(soapBody);
      req.end();
    });
  }

  /**
   * Get local IP address
   */
  async _getLocalIP() {
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      socket.connect(1, '8.8.8.8', () => {
        const address = socket.address().address;
        socket.close();
        resolve(address);
      });
      
      socket.on('error', () => {
        resolve('0.0.0.0');
      });
    });
  }
}

export default UPnPClient;
