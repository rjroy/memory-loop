import PlaceholderNotice from '../components/PlaceholderNotice';
import RouteHeading from '../shell/RouteHeading';

export default function CaptureView() {
  return (
    <div className="capture-view">
      <div>
        <RouteHeading route="/capture">Capture</RouteHeading>
        <p className="view-purpose">Save thoughts as timestamped entries in a daily Markdown note.</p>
      </div>
      <PlaceholderNotice heading="Quick capture isn't available yet">
        <p>Note entry and saving are not available in this preview.</p>
      </PlaceholderNotice>
    </div>
  );
}
