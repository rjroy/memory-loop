import type { ReactNode } from 'react';

type PlaceholderNoticeProps = {
  heading: string;
  children: ReactNode;
};

export default function PlaceholderNotice({ heading, children }: PlaceholderNoticeProps) {
  return (
    <section className="placeholder-notice">
      <h2>{heading}</h2>
      {children}
    </section>
  );
}
