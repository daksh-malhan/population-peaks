import type { Exporter } from '../app/app';

// Placeholder until poster export lands (next task).
export const posterExporter: Exporter = {
  canPrint: () => false,
  export: () => Promise.reject(new Error('poster export is not implemented yet')),
};
