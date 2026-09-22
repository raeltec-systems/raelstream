import { Card } from '@raelstream/ui';
import s from './steps.module.css';

/** Honest placeholder: the step exists in the flow but its function is not built yet (B§27.1). */
export function NotBuiltStep({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h1 className="rs-h1">{title}</h1>
      <Card>
        <p className={s.muted}>{body}</p>
      </Card>
    </>
  );
}
