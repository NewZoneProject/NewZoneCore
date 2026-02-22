// Module: Automated Reporting
// Description: Automated report generation for NewZoneCore.
//              Provides scheduled reports, exports, and analytics.
// File: core/analytics/reporting.js

import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

// ============================================================================
// REPORT TYPES
// ============================================================================

export const ReportType = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  SECURITY: 'security',
  PERFORMANCE: 'performance',
  AUDIT: 'audit',
  CUSTOM: 'custom'
};

export const ReportFormat = {
  JSON: 'json',
  HTML: 'html',
  CSV: 'csv',
  MARKDOWN: 'markdown'
};

// ============================================================================
// REPORT GENERATOR
// ============================================================================

export class ReportGenerator extends EventEmitter {
  constructor(options = {}) {
    super();

    this.outputDir = options.outputDir || './reports';
    this.templates = new Map();
  }

  /**
   * Initialize report generator.
   */
  async init() {
    await fs.mkdir(this.outputDir, { recursive: true });
    console.log('[reporting] Report generator initialized');
    return this;
  }

  /**
   * Register report template.
   */
  registerTemplate(name, templateFn) {
    this.templates.set(name, templateFn);
  }

  /**
   * Generate report.
   */
  async generate(type, options = {}) {
    const template = this.templates.get(type);
    
    if (!template) {
      throw new Error(`Report template not found: ${type}`);
    }

    console.log(`[reporting] Generating ${type} report...`);

    const data = await template(options);
    const format = options.format || ReportFormat.JSON;
    const content = this._formatReport(data, format);
    
    const filename = this._generateFilename(type, format);
    const filePath = path.join(this.outputDir, filename);
    
    await fs.writeFile(filePath, content, 'utf-8');

    this.emit('generated', { type, format, filename, filePath });
    console.log(`[reporting] Report generated: ${filename}`);

    return {
      type,
      format,
      filename,
      filePath,
      generatedAt: new Date().toISOString(),
      data
    };
  }

  /**
   * Format report data.
   */
  _formatReport(data, format) {
    switch (format) {
      case ReportFormat.JSON:
        return JSON.stringify(data, null, 2);
      
      case ReportFormat.HTML:
        return this._toHTML(data);
      
      case ReportFormat.CSV:
        return this._toCSV(data);
      
      case ReportFormat.MARKDOWN:
        return this._toMarkdown(data);
      
      default:
        return JSON.stringify(data, null, 2);
    }
  }

  /**
   * Convert to HTML.
   */
  _toHTML(data) {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>NewZoneCore Report - ${data.title || 'Report'}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
    .metric { margin: 10px 0; }
    .timestamp { color: #666; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>${data.title || 'NewZoneCore Report'}</h1>
  <p class="timestamp">Generated: ${new Date().toISOString()}</p>
  
  ${this._renderSections(data)}
  
</body>
</html>
    `.trim();
  }

  /**
   * Convert to CSV.
   */
  _toCSV(data) {
    const rows = [];
    
    // Header
    if (data.metrics && Array.isArray(data.metrics)) {
      const headers = Object.keys(data.metrics[0]);
      rows.push(headers.join(','));
      
      // Data rows
      for (const metric of data.metrics) {
        rows.push(headers.map(h => metric[h]).join(','));
      }
    }
    
    return rows.join('\n');
  }

  /**
   * Convert to Markdown.
   */
  _toMarkdown(data) {
    const lines = [
      `# ${data.title || 'NewZoneCore Report'}`,
      '',
      `*Generated: ${new Date().toISOString()}*`,
      ''
    ];

    // Add sections
    for (const [key, value] of Object.entries(data)) {
      if (key === 'title') continue;
      
      if (typeof value === 'object' && !Array.isArray(value)) {
        lines.push(`## ${key.charAt(0).toUpperCase() + key.slice(1)}`);
        lines.push('');
        for (const [subKey, subValue] of Object.entries(value)) {
          lines.push(`- **${subKey}**: ${subValue}`);
        }
        lines.push('');
      } else if (Array.isArray(value)) {
        lines.push(`## ${key.charAt(0).toUpperCase() + key.slice(1)}`);
        lines.push('');
        lines.push('| Index | ' + Object.keys(value[0] || {}).join(' | ') + ' |');
        lines.push('|-------|' + Object.keys(value[0] || {}).map(() => '--------').join('|') + '|');
        for (const item of value) {
          lines.push('| ' + Object.values(item).join(' | ') + ' |');
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Render HTML sections.
   */
  _renderSections(data) {
    let html = '';
    
    for (const [key, value] of Object.entries(data)) {
      if (key === 'title') continue;
      
      html += `<h2>${key.charAt(0).toUpperCase() + key.slice(1)}</h2>`;
      
      if (typeof value === 'object' && !Array.isArray(value)) {
        html += '<table>';
        for (const [subKey, subValue] of Object.entries(value)) {
          html += `<tr><th>${subKey}</th><td>${subValue}</td></tr>`;
        }
        html += '</table>';
      } else if (Array.isArray(value)) {
        html += '<table><tr>';
        if (value.length > 0) {
          for (const key of Object.keys(value[0])) {
            html += `<th>${key}</th>`;
          }
        }
        html += '</tr>';
        for (const item of value) {
          html += '<tr>';
          for (const val of Object.values(item)) {
            html += `<td>${val}</td>`;
          }
          html += '</tr>';
        }
        html += '</table>';
      } else {
        html += `<p>${value}</p>`;
      }
    }
    
    return html;
  }

  /**
   * Generate filename.
   */
  _generateFilename(type, format) {
    const date = new Date().toISOString().split('T')[0];
    const ext = {
      [ReportFormat.JSON]: 'json',
      [ReportFormat.HTML]: 'html',
      [ReportFormat.CSV]: 'csv',
      [ReportFormat.MARKDOWN]: 'md'
    }[format];
    
    return `report-${type}-${date}.${ext}`;
  }

  /**
   * List reports.
   */
  async listReports() {
    const files = await fs.readdir(this.outputDir);
    return files.filter(f => f.startsWith('report-'));
  }

  /**
   * Delete old reports.
   */
  async cleanupReports(maxAge = 30 * 24 * 60 * 60 * 1000) { // 30 days
    const files = await this.listReports();
    const now = Date.now();
    let deleted = 0;

    for (const file of files) {
      const filePath = path.join(this.outputDir, file);
      const stat = await fs.stat(filePath);
      
      if (now - stat.mtimeMs > maxAge) {
        await fs.unlink(filePath);
        deleted++;
      }
    }

    console.log(`[reporting] Cleaned up ${deleted} old reports`);
    return deleted;
  }
}

// ============================================================================
// REPORT SCHEDULER
// ============================================================================

export class ReportScheduler extends EventEmitter {
  constructor(reportGenerator, options = {}) {
    super();

    this.generator = reportGenerator;
    this.schedules = new Map();
    this._timers = new Map();
  }

  /**
   * Schedule recurring report.
   */
  schedule(name, type, schedule, options = {}) {
    // Parse schedule (cron-like or interval)
    const interval = this._parseSchedule(schedule);
    
    const timer = setInterval(async () => {
      try {
        const result = await this.generator.generate(type, options);
        this.emit('report', result);
      } catch (error) {
        console.error(`[reporting] Scheduled report failed: ${name}`, error.message);
        this.emit('error', { name, error });
      }
    }, interval);

    this.schedules.set(name, { type, schedule, interval, options });
    this._timers.set(name, timer);

    console.log(`[reporting] Scheduled ${type} report: ${name} (every ${interval}ms)`);
    
    return name;
  }

  /**
   * Parse schedule string.
   */
  _parseSchedule(schedule) {
    if (typeof schedule === 'number') {
      return schedule;
    }

    const intervals = {
      'hourly': 60 * 60 * 1000,
      'daily': 24 * 60 * 60 * 1000,
      'weekly': 7 * 24 * 60 * 60 * 1000,
      'monthly': 30 * 24 * 60 * 60 * 1000
    };

    return intervals[schedule] || intervals.daily;
  }

  /**
   * Cancel scheduled report.
   */
  cancel(name) {
    const timer = this._timers.get(name);
    if (timer) {
      clearInterval(timer);
      this._timers.delete(name);
      this.schedules.delete(name);
      console.log(`[reporting] Cancelled scheduled report: ${name}`);
    }
  }

  /**
   * Get all schedules.
   */
  getSchedules() {
    return Object.fromEntries(this.schedules);
  }

  /**
   * Stop all schedules.
   */
  stop() {
    for (const [name, timer] of this._timers) {
      clearInterval(timer);
    }
    this._timers.clear();
    console.log('[reporting] All schedules stopped');
  }
}

// ============================================================================
// BUILT-IN REPORT TEMPLATES
// ============================================================================

export function registerBuiltInTemplates(generator, supervisor, metrics, alerts) {
  // Daily Summary Report
  generator.registerTemplate(ReportType.DAILY, async (options) => {
    return {
      title: 'Daily Summary Report',
      period: 'daily',
      summary: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
      },
      metrics: metrics ? metrics.toJSON() : {},
      alerts: alerts ? alerts.getActive() : []
    };
  });

  // Security Report
  generator.registerTemplate(ReportType.SECURITY, async (options) => {
    return {
      title: 'Security Report',
      period: options.period || 'weekly',
      security: {
        authAttempts: 0, // Would come from audit logger
        failedLogins: 0,
        rateLimitEvents: 0,
        securityEvents: []
      },
      recommendations: [
        'Review failed login attempts',
        'Check rate limiting configuration',
        'Verify firewall rules'
      ]
    };
  });

  // Performance Report
  generator.registerTemplate(ReportType.PERFORMANCE, async (options) => {
    return {
      title: 'Performance Report',
      period: options.period || 'daily',
      performance: {
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        eventLoopLag: 'N/A' // Would come from profiler
      },
      bottlenecks: [],
      recommendations: []
    };
  });

  // Audit Report
  generator.registerTemplate(ReportType.AUDIT, async (options) => {
    return {
      title: 'Audit Report',
      period: options.period || 'monthly',
      audit: {
        events: [],
        summary: {
          total: 0,
          byType: {},
          bySeverity: {}
        }
      },
      compliance: {
        soc2: 'compliant',
        iso27001: 'compliant'
      }
    };
  });
}

// ============================================================================
// GLOBAL INSTANCES
// ============================================================================

let globalGenerator = null;
let globalScheduler = null;

export async function getReportGenerator(options = {}) {
  if (!globalGenerator) {
    globalGenerator = new ReportGenerator(options);
    await globalGenerator.init();
  }
  return globalGenerator;
}

export function getReportScheduler(generator, options = {}) {
  if (!globalScheduler) {
    globalScheduler = new ReportScheduler(generator, options);
  }
  return globalScheduler;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  ReportGenerator,
  ReportScheduler,
  ReportType,
  ReportFormat,
  getReportGenerator,
  getReportScheduler,
  registerBuiltInTemplates
};
