import PlaceholderNotice from '../components/PlaceholderNotice';

export default function ThinkView() {
  return (
    <>
      <h1 id="view-heading" tabIndex={-1}>Think</h1>
      <p className="view-purpose">Discuss ideas with AI using vault context.</p>
      <PlaceholderNotice heading="AI chat isn't available yet">
        <p>This preview can't send messages or access vault context.</p>
      </PlaceholderNotice>
    </>
  );
}
