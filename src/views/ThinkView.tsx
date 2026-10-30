import PlaceholderNotice from '../components/PlaceholderNotice';

export default function ThinkView() {
  return (
    <div className="think-view">
      <h1 id="view-heading" tabIndex={-1}>Think</h1>
      <p className="view-purpose">Discuss ideas with AI using vault context.</p>
      <div className="think-invitation">
        <p className="brand-invitation">What else could this become?</p>
        <img src="/brand/the-guide/approved-a5.svg" width="96" height="96" alt="" />
      </div>
      <PlaceholderNotice heading="AI chat isn't available yet">
        <p>This preview can't send messages or access vault context.</p>
      </PlaceholderNotice>
    </div>
  );
}
