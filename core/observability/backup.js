// Module: Backup and Recovery
// Description: Encrypted backup and recovery system for NewZoneCore environment.
//              Supports full, incremental, and scheduled backups.
// File: core/observability/backup.js

import fs from 'fs/promises';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { randomBytes, createHash } from 'crypto';
import { createGzip, createGunzip } from 'zlib';

// ============================================================================
// BACKUP TYPES
// ============================================================================

export const BackupType = {
  FULL: 'full',           // Complete backup
  INCREMENTAL: 'incremental', // Only changes since last backup
  DIFFERENTIAL: 'differential' // Changes since last full backup
};

export const BackupStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  VERIFIED: 'verified'
};

// ============================================================================
// BACKUP METADATA
// ============================================================================

export class BackupMetadata {
  constructor(options = {}) {
    this.id = options.id || randomBytes(8).toString('hex');
    this.type = options.type || BackupType.FULL;
    this.status = options.status || BackupStatus.PENDING;
    this.createdAt = options.createdAt || new Date().toISOString();
    this.completedAt = options.completedAt || null;
    this.size = options.size || 0;
    this.checksum = options.checksum || null;
    this.encrypted = options.encrypted !== false;
    this.compressed = options.compressed !== false;
    
    // Content info
    this.files = options.files || [];
    this.fileCount = options.fileCount || 0;
    
    // Encryption info
    this.nonce = options.nonce || null;
    this.keyId = options.keyId || null;
    
    // Description
    this.description = options.description || '';
    this.tags = options.tags || [];
    
    // Validation
    this.verifiedAt = options.verifiedAt || null;
    this.verificationError = options.verificationError || null;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      status: this.status,
      createdAt: this.createdAt,
      completedAt: this.completedAt,
      size: this.size,
      checksum: this.checksum,
      encrypted: this.encrypted,
      compressed: this.compressed,
      files: this.files,
      fileCount: this.fileCount,
      description: this.description,
      tags: this.tags,
      verifiedAt: this.verifiedAt
    };
  }
}

// ============================================================================
// BACKUP MANAGER
// ============================================================================

export class BackupManager {
  constructor(options = {}) {
    this.backupDir = options.backupDir || './backups';
    this.envDir = options.envDir || './env';
    this.maxBackups = options.maxBackups || 10;
    this.encryptionKey = options.encryptionKey; // 32-byte key for backup encryption
    
    this.metadataFile = path.join(this.backupDir, 'metadata.json');
    this._metadata = null;
  }

  /**
   * Initialize backup manager.
   */
  async init() {
    // Create backup directory
    await fs.mkdir(this.backupDir, { recursive: true });
    
    // Load metadata
    try {
      const data = await fs.readFile(this.metadataFile, 'utf-8');
      this._metadata = JSON.parse(data);
    } catch (error) {
      this._metadata = { backups: [], lastFullBackup: null };
    }
    
    console.log('[backup] Backup manager initialized');
    return this;
  }

  /**
   * Create backup.
   */
  async createBackup(options = {}) {
    const type = options.type || BackupType.FULL;
    const description = options.description || '';
    const tags = options.tags || [];
    
    const metadata = new BackupMetadata({
      type,
      description,
      tags,
      status: BackupStatus.IN_PROGRESS
    });
    
    console.log(`[backup] Creating ${type} backup: ${metadata.id}`);
    
    try {
      const backupPath = path.join(this.backupDir, `${metadata.id}.nzbackup`);
      const files = await this._collectFiles(type);
      
      // Create backup archive
      const archiveData = await this._createArchive(files);
      
      // Compress
      const compressedData = await this._compress(archiveData);
      
      // Encrypt
      const encryptedData = this.encryptionKey 
        ? await this._encrypt(compressedData, this.encryptionKey)
        : compressedData;
      
      // Write to file
      await fs.writeFile(backupPath, encryptedData);
      
      // Calculate checksum
      const checksum = createHash('sha256').update(encryptedData).digest('hex');
      
      // Update metadata
      metadata.status = BackupStatus.COMPLETED;
      metadata.completedAt = new Date().toISOString();
      metadata.size = encryptedData.length;
      metadata.checksum = checksum;
      metadata.files = files.map(f => f.path);
      metadata.fileCount = files.length;
      metadata.encrypted = !!this.encryptionKey;
      
      if (type === BackupType.FULL) {
        this._metadata.lastFullBackup = metadata.createdAt;
      }
      
      this._metadata.backups.push(metadata.toJSON());
      await this._saveMetadata();
      
      // Cleanup old backups
      await this._cleanupOldBackups();
      
      console.log(`[backup] Backup completed: ${metadata.id} (${metadata.size} bytes)`);
      
      return metadata;
      
    } catch (error) {
      metadata.status = BackupStatus.FAILED;
      metadata.verificationError = error.message;
      
      this._metadata.backups.push(metadata.toJSON());
      await this._saveMetadata();
      
      console.error('[backup] Backup failed:', error.message);
      throw error;
    }
  }

  /**
   * Restore from backup.
   */
  async restoreBackup(backupId, options = {}) {
    const metadata = this._metadata.backups.find(b => b.id === backupId);
    
    if (!metadata) {
      throw new Error(`Backup ${backupId} not found`);
    }
    
    if (metadata.status !== BackupStatus.COMPLETED) {
      throw new Error(`Backup ${backupId} is not completed (status: ${metadata.status})`);
    }
    
    console.log(`[backup] Restoring from backup: ${backupId}`);
    
    try {
      const backupPath = path.join(this.backupDir, `${backupId}.nzbackup`);
      let data = await fs.readFile(backupPath);
      
      // Decrypt if encrypted
      if (metadata.encrypted && this.encryptionKey) {
        data = await this._decrypt(data, this.encryptionKey);
      }
      
      // Decompress
      data = await this._decompress(data);
      
      // Extract archive
      await this._extractArchive(data, this.envDir);
      
      console.log(`[backup] Restore completed from ${backupId}`);
      
      return metadata;
      
    } catch (error) {
      console.error('[backup] Restore failed:', error.message);
      throw error;
    }
  }

  /**
   * Verify backup integrity.
   */
  async verifyBackup(backupId) {
    const metadata = this._metadata.backups.find(b => b.id === backupId);
    
    if (!metadata) {
      throw new Error(`Backup ${backupId} not found`);
    }
    
    console.log(`[backup] Verifying backup: ${backupId}`);
    
    try {
      const backupPath = path.join(this.backupDir, `${backupId}.nzbackup`);
      const data = await fs.readFile(backupPath);
      
      // Verify checksum
      const checksum = createHash('sha256').update(data).digest('hex');
      
      if (checksum !== metadata.checksum) {
        throw new Error('Checksum mismatch - backup may be corrupted');
      }
      
      // Try to decrypt and decompress
      let decrypted = data;
      if (metadata.encrypted && this.encryptionKey) {
        decrypted = await this._decrypt(data, this.encryptionKey);
      }
      
      const decompressed = await this._decompress(decrypted);
      
      // Try to extract (verify format)
      const archive = JSON.parse(decompressed.toString('utf-8'));
      
      if (!archive.files || !Array.isArray(archive.files)) {
        throw new Error('Invalid backup format');
      }
      
      // Update metadata
      metadata.status = BackupStatus.VERIFIED;
      metadata.verifiedAt = new Date().toISOString();
      
      await this._saveMetadata();
      
      console.log(`[backup] Backup verified: ${backupId}`);
      
      return { valid: true, metadata };
      
    } catch (error) {
      metadata.verificationError = error.message;
      await this._saveMetadata();
      
      console.error('[backup] Verification failed:', error.message);
      
      return { valid: false, error: error.message, metadata };
    }
  }

  /**
   * List all backups.
   */
  listBackups() {
    return this._metadata.backups.map(b => ({
      ...b,
      age: Date.now() - new Date(b.createdAt).getTime()
    }));
  }

  /**
   * Get backup by ID.
   */
  getBackup(backupId) {
    return this._metadata.backups.find(b => b.id === backupId);
  }

  /**
   * Delete backup.
   */
  async deleteBackup(backupId) {
    const index = this._metadata.backups.findIndex(b => b.id === backupId);
    
    if (index === -1) {
      throw new Error(`Backup ${backupId} not found`);
    }
    
    const backupPath = path.join(this.backupDir, `${backupId}.nzbackup`);
    
    try {
      await fs.unlink(backupPath);
      this._metadata.backups.splice(index, 1);
      await this._saveMetadata();
      
      console.log(`[backup] Deleted backup: ${backupId}`);
      
      return true;
    } catch (error) {
      console.error('[backup] Delete failed:', error.message);
      throw error;
    }
  }

  /**
   * Get latest backup.
   */
  getLatestBackup(type = null) {
    let backups = this._metadata.backups
      .filter(b => b.status === BackupStatus.COMPLETED || b.status === BackupStatus.VERIFIED);
    
    if (type) {
      backups = backups.filter(b => b.type === type);
    }
    
    return backups.sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    )[0];
  }

  /**
   * Collect files for backup.
   */
  async _collectFiles(type) {
    const files = [];
    const lastFullBackup = type === BackupType.INCREMENTAL 
      ? this._metadata.lastFullBackup 
      : null;
    
    const envFiles = [
      'master.key',
      'seed.enc',
      'seed.txt',
      'trust.json',
      'config.json'
    ];
    
    for (const file of envFiles) {
      const filePath = path.join(this.envDir, file);
      
      try {
        const stat = await fs.stat(filePath);
        
        // For incremental backups, check modification time
        if (lastFullBackup) {
          const mtime = new Date(stat.mtime).toISOString();
          if (mtime < lastFullBackup) {
            continue; // Skip unmodified files
          }
        }
        
        const content = await fs.readFile(filePath);
        
        files.push({
          path: file,
          size: content.length,
          mtime: stat.mtime.toISOString(),
          checksum: createHash('sha256').update(content).digest('hex'),
          content
        });
        
      } catch (error) {
        // File doesn't exist - that's ok
        if (error.code !== 'ENOENT') {
          console.error(`[backup] Error reading ${file}:`, error.message);
        }
      }
    }
    
    // Also backup keys directory
    const keysDir = path.join(this.envDir, 'keys');
    try {
      const keys = await fs.readdir(keysDir);
      
      for (const key of keys) {
        const filePath = path.join(keysDir, key);
        const stat = await fs.stat(filePath);
        const content = await fs.readFile(filePath);
        
        if (lastFullBackup) {
          const mtime = new Date(stat.mtime).toISOString();
          if (mtime < lastFullBackup) continue;
        }
        
        files.push({
          path: `keys/${key}`,
          size: content.length,
          mtime: stat.mtime.toISOString(),
          checksum: createHash('sha256').update(content).digest('hex'),
          content
        });
      }
    } catch (error) {
      // Keys directory doesn't exist
    }
    
    return files;
  }

  /**
   * Create backup archive.
   */
  async _createArchive(files) {
    const archive = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      files: files.map(f => ({
        path: f.path,
        size: f.size,
        mtime: f.mtime,
        checksum: f.checksum
      })),
      content: files.reduce((acc, f) => {
        acc[f.path] = f.content.toString('base64');
        return acc;
      }, {})
    };
    
    return Buffer.from(JSON.stringify(archive), 'utf-8');
  }

  /**
   * Extract archive.
   */
  async _extractArchive(data, targetDir) {
    const archive = JSON.parse(data.toString('utf-8'));
    
    for (const [filePath, contentBase64] of Object.entries(archive.content)) {
      const fullPath = path.join(targetDir, filePath);
      const dir = path.dirname(fullPath);
      
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, Buffer.from(contentBase64, 'base64'));
      
      console.log(`[backup] Restored: ${filePath}`);
    }
  }

  /**
   * Compress data.
   */
  async _compress(data) {
    // For small data, compression may not be beneficial
    if (data.length < 1024) {
      return data;
    }
    
    return new Promise((resolve, reject) => {
      const chunks = [];
      const gzip = createGzip({ level: 9 });
      
      gzip.on('data', chunk => chunks.push(chunk));
      gzip.on('end', () => resolve(Buffer.concat(chunks)));
      gzip.on('error', reject);
      
      gzip.end(data);
    });
  }

  /**
   * Decompress data.
   */
  async _decompress(data) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const gunzip = createGunzip();
      
      gunzip.on('data', chunk => chunks.push(chunk));
      gunzip.on('end', () => resolve(Buffer.concat(chunks)));
      gunzip.on('error', reject);
      
      gunzip.end(data);
    });
  }

  /**
   * Encrypt data.
   */
  async _encrypt(data, key) {
    const { chacha20poly1305 } = await import('../libs/chacha20poly1305.js');
    const nonce = randomBytes(12);
    
    const encrypted = chacha20poly1305.encrypt(key, nonce, data);
    
    // Prepend nonce to ciphertext
    return Buffer.concat([nonce, encrypted]);
  }

  /**
   * Decrypt data.
   */
  async _decrypt(data, key) {
    const { chacha20poly1305 } = await import('../libs/chacha20poly1305.js');
    
    const nonce = data.slice(0, 12);
    const ciphertext = data.slice(12);
    
    return chacha20poly1305.decrypt(key, nonce, ciphertext);
  }

  /**
   * Save metadata.
   */
  async _saveMetadata() {
    await fs.writeFile(
      this.metadataFile,
      JSON.stringify(this._metadata, null, 2),
      'utf-8'
    );
  }

  /**
   * Cleanup old backups.
   */
  async _cleanupOldBackups() {
    if (this._metadata.backups.length <= this.maxBackups) {
      return;
    }
    
    // Sort by date, newest first
    const sorted = this._metadata.backups.sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    
    // Keep only maxBackups
    const toDelete = sorted.slice(this.maxBackups);
    
    for (const backup of toDelete) {
      try {
        await this.deleteBackup(backup.id);
      } catch (error) {
        console.error('[backup] Cleanup failed for', backup.id, error.message);
      }
    }
  }
}

// ============================================================================
// BACKUP SCHEDULER
// ============================================================================

export class BackupScheduler {
  constructor(backupManager, options = {}) {
    this.backupManager = backupManager;
    this.fullBackupInterval = options.fullBackupInterval || 7 * 24 * 60 * 60 * 1000; // 7 days
    this.incrementalInterval = options.incrementalInterval || 24 * 60 * 60 * 1000; // 1 day
    this.enabled = options.enabled !== false;
    
    this._fullTimer = null;
    this._incrementalTimer = null;
  }

  /**
   * Start scheduled backups.
   */
  start() {
    if (!this.enabled) return;
    
    console.log('[backup] Starting scheduled backups');
    console.log(`[backup] Full backup interval: ${this.fullBackupInterval / 1000 / 3600} hours`);
    console.log(`[backup] Incremental interval: ${this.incrementalInterval / 1000 / 3600} hours`);
    
    // Schedule full backup
    this._fullTimer = setInterval(async () => {
      try {
        await this.backupManager.createBackup({
          type: BackupType.FULL,
          description: 'Scheduled full backup',
          tags: ['scheduled', 'full']
        });
      } catch (error) {
        console.error('[backup] Scheduled full backup failed:', error.message);
      }
    }, this.fullBackupInterval);
    
    // Schedule incremental backup
    this._incrementalTimer = setInterval(async () => {
      try {
        await this.backupManager.createBackup({
          type: BackupType.INCREMENTAL,
          description: 'Scheduled incremental backup',
          tags: ['scheduled', 'incremental']
        });
      } catch (error) {
        console.error('[backup] Scheduled incremental backup failed:', error.message);
      }
    }, this.incrementalInterval);
  }

  /**
   * Stop scheduled backups.
   */
  stop() {
    if (this._fullTimer) clearInterval(this._fullTimer);
    if (this._incrementalTimer) clearInterval(this._incrementalTimer);
    
    console.log('[backup] Stopped scheduled backups');
  }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let globalBackupManager = null;

export async function getBackupManager(options = {}) {
  if (!globalBackupManager) {
    globalBackupManager = new BackupManager(options);
    await globalBackupManager.init();
  }
  return globalBackupManager;
}

export function createBackupManager(options = {}) {
  return new BackupManager(options);
}

export function createBackupScheduler(backupManager, options = {}) {
  return new BackupScheduler(backupManager, options);
}
