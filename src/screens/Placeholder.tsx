import { Card } from '../components/ui/Card';

export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <Card>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-muted mt-1">{note}</p>
    </Card>
  );
}
