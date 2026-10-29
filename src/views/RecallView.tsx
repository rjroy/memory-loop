import PlaceholderNotice from '../components/PlaceholderNotice';

export default function RecallView() {
  return (
    <>
      <h1 id="view-heading" tabIndex={-1}>Recall</h1>
      <p className="view-purpose">Access files in your vault.</p>
      <PlaceholderNotice heading="Vault access isn't available yet">
        <p>This preview can't list, open, or search vault files.</p>
      </PlaceholderNotice>
    </>
  );
}
