import AppLink from '../shell/AppLink';
import RouteHeading from '../shell/RouteHeading';

export default function NotFoundView() {
  return (
    <>
      <RouteHeading route="not-found">Page not found</RouteHeading>
      <p className="view-purpose">This address doesn't match a Memory Loop view.</p>
      <AppLink className="content-link recovery-link" href="/ground">Go to Ground</AppLink>
    </>
  );
}
