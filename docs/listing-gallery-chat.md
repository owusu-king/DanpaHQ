# Listing gallery and property chat

Web rental and sale detail pages preview up to five distinct gallery records:
one large image on the left and four in a two-by-two grid on the right. Fewer
photos use smaller layouts without duplicating images. Small screens show the
lead photo; the existing full viewer retains every photo and its source label.

The ask bar opens the existing Danpa Intel widget with the submitted question
and an explicit public listing context. Existing conversations show **Continue
chat**, including after refresh and after visiting another property.

History is local to the browser tab (`sessionStorage`), scoped by account,
rental/sale kind and listing ID, and bounded to 40 messages. Storage failures
fall back to memory. Closing the tab ends the saved browser session; this is
not server-side or cross-device history. The bar and local assistant are
available to both guests and signed-in users on these detail pages.

**Live AI replies are not configured in this project.** The widget explicitly
states that limitation and displays only allowlisted public listing facts.
There is no external AI request, API key, new dependency or backend change.

Validation: 577 web tests passed, TypeScript and targeted ESLint passed, and
the stylesheet parsed successfully. Live browser checks used a real six-photo
rental: the five-image mosaic, correct fifth/sixth photo navigation, query
handoff, refresh/resume, separate property conversations and a 390px viewport.
