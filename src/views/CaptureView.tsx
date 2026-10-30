import PlaceholderNotice from '../components/PlaceholderNotice';

export default function CaptureView() {
  return (
    <div className="capture-view">
      <div>
        <h1 id="view-heading" tabIndex={-1}>Capture</h1>
        <p className="view-purpose">Save thoughts as timestamped entries in a daily Markdown note.</p>
      </div>
      <PlaceholderNotice heading="Quick capture isn't available yet">
        <p>Note entry and saving are not available in this preview.</p>
      </PlaceholderNotice>
    </div>
  );
}
