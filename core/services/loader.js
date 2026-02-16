// Module: Local Service Loader
// Description: Loads and starts all local services using the service lifecycle.
// File: core/services/loader.js

import fs from 'fs/promises';
import path from 'path';
import { createService } from './lifecycle.js';

/**
 * Load all local services from core/services/*.js (except lifecycle.js and loader.js)
 * and start their lifecycle.
 *
 * @param {Object} options
 * @param {Object} options.supervisor
 * @param {string} options.ROOT
 */
export async function loadLocalServices({ supervisor, ROOT }) {
  const servicesDir = path.join(ROOT, 'core/services');

  let files = [];
  try {
    files = await fs.readdir(servicesDir);
  } catch (err) {
    console.log('[services] no services directory found');
    return;
  }

  // Filter out lifecycle.js and loader.js
  const serviceFiles = files.filter(
    f => f.endsWith('.js') && f !== 'lifecycle.js' && f !== 'loader.js'
  );

  for (const file of serviceFiles) {
    const fullPath = path.join(servicesDir, file);

    try {
      const mod = await import(fullPath);

      if (!mod?.createLocalService) {
        console.log(`[services] skipped ${file} (no createLocalService)`);
        continue;
      }

      // Create service instance
      const service = mod.createLocalService({ supervisor });

      // Lifecycle
      await service.init();
      await service.start();

      console.log(`[services] started: ${service.name}`);
    } catch (err) {
      console.log(`[services] failed to load ${file}:`, err.message);
    }
  }
}

