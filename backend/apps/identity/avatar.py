"""Setting and clearing a profile photo.

`Profile.avatar` has been a column since the profile table existed, pointing at
`files.StoredFile`, and was exposed nowhere — no serializer, no endpoint, no
screen. So the storage question is already answered: this reuses the same
reserve-upload, scan, then link flow every other file goes through, and adds no
second path for images.

What it adds is the rule about *whose* file may be linked. A profile photo is
set by handing the server a file id, and a file id is guessable in the way any
identifier is, so without an ownership check a person could point their avatar at
somebody else's uploaded document and have the product serve it back to them.
That check is here rather than in the serializer because clearing and setting
both go through it, and a rule that lives in one of two places is a rule that
will eventually be applied in one of two places.
"""

from __future__ import annotations

from apps.core.exceptions import ValidationFailed

#: The only purpose a profile photo may have been uploaded under.
#:
#: Enforced so that an identity document — uploaded for verification, and
#: sensitive — cannot be promoted into a public-facing avatar by reusing its id.
#: The two have different retention rules and very different audiences.
AVATAR_PURPOSE = "avatar"


def resolve_avatar_file(*, user, file_id):
    """The file this person may use as their photo, or a refusal saying why.

    Returns None for a null id, which is how a photo is removed.
    """
    if file_id in (None, ""):
        return None

    from apps.files.models import StoredFile

    stored = StoredFile.objects.filter(id=file_id).first()
    if stored is None:
        raise ValidationFailed("We could not find that upload. Try uploading the photo again.")

    # Deliberately the same message for "not yours" and "does not exist" above is
    # *not* used here: the id was found, so the distinction is already leaked by
    # timing. What matters is that the file is not attachable, and saying so
    # plainly is more useful than a vague refusal.
    if not stored.is_owned_by(user):
        raise ValidationFailed("That upload belongs to another account.")

    if stored.purpose != AVATAR_PURPOSE:
        raise ValidationFailed(
            "That file was uploaded for something else. Upload it again as a profile photo."
        )

    if not stored.is_usable:
        raise ValidationFailed("That photo is still being checked. Try again in a moment.")

    return stored


def set_avatar(*, profile, user, file_id) -> None:
    """Attach a photo, or remove the one there.

    Only saves when something actually changes, so a PATCH that happens to
    include an unchanged avatar does not write a row or move `updated_at`.
    """
    stored = resolve_avatar_file(user=user, file_id=file_id)
    new_id = stored.id if stored else None

    if str(profile.avatar_id or "") == str(new_id or ""):
        return

    profile.avatar = stored
    profile.save(update_fields=["avatar", "updated_at"])


def avatar_url(profile) -> str | None:
    """Where to *ask* for the photo, or None if there is nothing to ask for.

    Deliberately the download endpoint, not a storage URL. Two reasons, and both
    matter:

    **The endpoint returns JSON, not bytes.** `files.issue_download` mints a
    short-lived signed storage URL and hands it back, which is what keeps object
    storage private. So a client fetches this, reads `url` from the response, and
    renders that — it cannot be dropped into an `<img src>` directly.

    **The signed URL lives about five minutes.** Embedding one here would put an
    expiring link inside a payload that clients hold in memory for a whole
    session, and the photo would silently break partway through. A path that
    resolves on demand does not go stale.

    Returns None for a file that is not servable, so a client never renders a
    link that will fail — on a slow connection a broken image is worse than
    initials, because it retries.

    ### Who can see it

    `files.can_read` grants the owner, staff, and reviewers of an attached
    verification. There is no public branch, by design. So this shows a person
    their *own* photo; making avatars visible to a counterparty is a change to
    the file access model and belongs in its own decision, not here.
    """
    if not profile.avatar_id:
        return None
    avatar = profile.avatar
    if avatar is None or not avatar.is_usable:
        return None
    return f"/api/v1/files/{profile.avatar_id}/download/"
