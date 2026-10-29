import { Link } from 'react-router-dom';
import PlaceholderNotice from '../components/PlaceholderNotice';

export default function GroundView() {
  return (
    <>
      <h1 id="view-heading" tabIndex={-1}>Ground</h1>
      <p className="view-purpose">An overview built from interchangeable panels.</p>
      <PlaceholderNotice heading="Panels aren't available yet">
        <p>Panel contents haven't been chosen. This preview doesn't display vault information.</p>
        <Link className="content-link" to="/capture">Open Capture</Link>
      </PlaceholderNotice>
    </>
  );
}
