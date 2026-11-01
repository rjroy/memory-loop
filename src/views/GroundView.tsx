'use client';

import RouteHeading from '../shell/RouteHeading';
import { CardBoundary } from '../ground/GroundCard';
import QuickActionsCard from '../ground/QuickActionsCard';
import InspirationCard from '../ground/InspirationCard';
import PromptsCard from '../ground/PromptsCard';
import GoalsCard from '../ground/GoalsCard';
import RecentCapturesCard from '../ground/RecentCapturesCard';
import RecentConversationsCard from '../ground/RecentConversationsCard';
import '../ground/ground.css';

export default function GroundView() {
  return (
    <div className="ground-view">
      <div className="visually-hidden"><RouteHeading route="/ground">Ground</RouteHeading></div>
      <div className="ground-arrival">
        <p className="brand-invitation">Pick up a thread.</p>
        <img className="ground-art" src="/brand/the-guide/approved-a1.webp" width="1254" height="1254"
          alt="A guide offers a lantern between a warm mountain path and a cool, far-off city." />
      </div>
      <div className="ground-grid">
        <CardBoundary name="Quick Actions"><QuickActionsCard /></CardBoundary>
        <CardBoundary name="Inspiration"><InspirationCard /></CardBoundary>
        <CardBoundary name="Prompts"><PromptsCard /></CardBoundary>
        <CardBoundary name="Current Goals"><GoalsCard /></CardBoundary>
        <CardBoundary name="Recent captures"><RecentCapturesCard /></CardBoundary>
        <CardBoundary name="Recent conversations"><RecentConversationsCard /></CardBoundary>
      </div>
    </div>
  );
}
