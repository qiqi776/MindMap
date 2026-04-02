interface NodeFieldsLike {
  x?: unknown;
  y?: unknown;
  collapsed?: unknown;
  properties?: Record<string, unknown> | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function readNodePositionFields(node: NodeFieldsLike): { x: number; y: number } | null {
  if (isFiniteNumber(node.x) && isFiniteNumber(node.y)) {
    return {
      x: node.x,
      y: node.y,
    };
  }

  const properties = node.properties;
  if (!properties) {
    return null;
  }

  const { x, y } = properties;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return null;
  }

  return { x, y };
}

export function readNodeCollapsedField(node: NodeFieldsLike): boolean {
  if (typeof node.collapsed === 'boolean') {
    return node.collapsed;
  }

  return node.properties?.collapsed === true;
}

export function sanitizeNodeProperties(properties: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!properties) {
    return {};
  }

  const sanitizedProperties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'x' || key === 'y' || key === 'collapsed') {
      continue;
    }

    sanitizedProperties[key] = value;
  }

  return sanitizedProperties;
}
