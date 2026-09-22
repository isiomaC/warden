export interface PackMetadata {
  filename: string;
}

export function parsePackMetadata(output: string): PackMetadata;
