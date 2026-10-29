import { Link } from 'react-router-dom';

export default function NotFoundView() {
  return (
    <>
      <h1 id="view-heading" tabIndex={-1}>Page not found</h1>
      <p className="view-purpose">This address doesn't match a Memory Loop view.</p>
      <Link className="content-link recovery-link" to="/ground">Go to Ground</Link>
    </>
  );
}
