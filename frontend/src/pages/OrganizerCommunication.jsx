import { Link, useParams } from "react-router";
import EventCommunication from "../components/EventCommunication";

export default function OrganizerCommunication() {
  const { id } = useParams();
  return <div className="ec-workspace">
    <Link to={`/organizer/events/${id}/workspace`}>← Back to event workspace</Link>
    <EventCommunication key={id} eventId={id} manage />
  </div>;
}
