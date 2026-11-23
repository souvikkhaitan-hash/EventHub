import { Link } from "react-router";

import "../styles/auth-portals.css";


export default function AuthPortalSwitch({
  active = "student",
  mode = "login",
}) {
  const registering = mode === "register";

  return (
    <nav
      className="auth-portal-switch"
      aria-label={
        registering
          ? "Registration type"
          : "Sign-in type"
      }
    >
      <Link
        to={
          registering
            ? "/register"
            : "/login"
        }
        aria-current={
          active === "student"
            ? "page"
            : undefined
        }
      >
        Student
      </Link>

      <Link
        to={
          registering
            ? "/organizer/register"
            : "/organizer/login"
        }
        aria-current={
          active === "organizer"
            ? "page"
            : undefined
        }
      >
        Organizer
      </Link>
    </nav>
  );
}