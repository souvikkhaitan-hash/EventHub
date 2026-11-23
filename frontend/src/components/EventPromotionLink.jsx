import { Link, useParams } from "react-router";
import { useEventAccess } from "./EventAccessGate";

export default function EventPromotionLink() {
  const access = useEventAccess();
  const { id } = useParams();
  if (!access?.capabilities?.includes("edit_event")) return null;
  return <Link className="ep-workspace-link" to={`/organizer/events/${id}/promotion`}>Create event poster ↗</Link>;
}
