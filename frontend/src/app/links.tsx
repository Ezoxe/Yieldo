import { forwardRef, type ComponentProps, type MouseEvent } from "react";
import {
  Link as RouterLink,
  NavLink as RouterNavLink,
  useLocation,
  useResolvedPath,
  type To,
} from "react-router";

import { useReducedMotion } from "../design/motion/useReducedMotion";
import { routeDirection } from "./routeDirection";

/**
 * Every in-app link asks for a screen transition (View Transitions, through
 * the router's own `viewTransition`): the old screen fades out in 140ms while
 * the new one arrives, sideways when it is deeper or shallower in the same
 * family (app/viewTransitions.css). Before the router navigates, the link
 * writes which way it goes on the document root — the stylesheet reads it.
 *
 * Motion off — the Réglages switch or the OS — asks for no transition at all.
 * A browser without View Transitions simply navigates.
 *
 * These are the only `Link`/`NavLink` the screens import; react-router's own
 * would navigate without the transition.
 */
function useScreenTransition(to: To, onClick?: (event: MouseEvent<HTMLAnchorElement>) => void) {
  const reduced = useReducedMotion();
  const location = useLocation();
  const target = useResolvedPath(to);
  return {
    viewTransition: !reduced,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (!reduced) {
        document.documentElement.dataset.vtDir = String(
          routeDirection(location.pathname, target.pathname),
        );
      }
      onClick?.(event);
    },
  };
}

type LinkProps = ComponentProps<typeof RouterLink>;
type NavLinkProps = ComponentProps<typeof RouterNavLink>;

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { onClick, viewTransition, ...props },
  ref,
) {
  const transition = useScreenTransition(props.to, onClick);
  return (
    <RouterLink
      ref={ref}
      {...props}
      viewTransition={viewTransition ?? transition.viewTransition}
      onClick={transition.onClick}
    />
  );
});

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink(
  { onClick, viewTransition, ...props },
  ref,
) {
  const transition = useScreenTransition(props.to, onClick);
  return (
    <RouterNavLink
      ref={ref}
      {...props}
      viewTransition={viewTransition ?? transition.viewTransition}
      onClick={transition.onClick}
    />
  );
});
