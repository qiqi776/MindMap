import { GraphCanvas } from '@/components/GraphCanvas';
import type { GraphVO } from '@/hooks/useForceLayout';

const demoGraph: GraphVO = {
  nodes: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      type: 'text',
      content: 'Focus Node',
      properties: { x: 0, y: 0 },
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      type: 'person',
      content: 'Linked Node',
      properties: { x: 220, y: 0 },
    },
  ],
  edges: [
    {
      id: '33333333-3333-3333-3333-333333333333',
      source_id: '11111111-1111-1111-1111-111111111111',
      target_id: '22222222-2222-2222-2222-222222222222',
      relation_type: 'REFERENCE',
      weight: 1,
      properties: {},
    },
  ],
};

export default function App() {
  return (
    <main className="h-full w-full">
      <GraphCanvas graph={demoGraph} />
    </main>
  );
}
