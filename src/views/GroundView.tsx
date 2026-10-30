import { Link } from 'react-router-dom';
import PlaceholderNotice from '../components/PlaceholderNotice';

export default function GroundView() {
  return (
    <div className="ground-view">
      <h1 id="view-heading" tabIndex={-1}>Ground</h1>
      <p className="view-purpose">An overview built from interchangeable panels.</p>
      <div className="ground-arrival">
        <div className="ground-welcome">
          <p className="brand-invitation">Pick up a thread.</p>
          <PlaceholderNotice heading="Panels aren't available yet">
            <p>Panel contents haven't been chosen. This preview doesn't display vault information.</p>
            <Link className="content-link" to="/capture">Open Capture</Link>
          </PlaceholderNotice>
        </div>
        <img className="ground-art" src="/brand/the-guide/approved-a1.webp" width="1254" height="1254"
          alt="A guide offers a lantern between a warm mountain path and a cool, far-off city." />
      </div>
    </div>
  );
}
