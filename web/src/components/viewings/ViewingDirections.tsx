/**
 * How to find the viewing.
 *
 * The street, house number, GhanaPost address, coordinates and the note for
 * finding this particular door are possession-sensitive: the serializer
 * releases them only during a valid confirmed appointment, and returns null
 * otherwise. So this component renders whatever it is given and asks no
 * questions — if it is on screen, the backend decided it should be.
 *
 * Shared by the provider's viewing record and the tenant's, because both are
 * looking for the same door.
 */
export type ReleasedDirections = {
  street: string | null;
  house_number: string | null;
  digital_address: string | null;
  latitude: string | null;
  longitude: string | null;
  entrance_note: string | null;
  building: string;
  wing: string;
};

export function ViewingDirections({ directions }: { directions: ReleasedDirections }) {
  const address = [directions.house_number, directions.street].filter(Boolean).join(" ");
  const withinProperty = [directions.building, directions.wing].filter(Boolean).join(" · ");
  const mapUrl =
    directions.latitude && directions.longitude
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${directions.latitude},${directions.longitude}`)}`
      : null;

  return (
    <section className="viewing-directions" aria-label="How to find the viewing">
      <h3>How to find it</h3>
      {address ? <p className="viewing-address">{address}</p> : null}
      {directions.digital_address ? (
        <p className="type-caption">GhanaPost GPS: {directions.digital_address}</p>
      ) : null}
      {withinProperty ? <p className="type-caption">{withinProperty}</p> : null}
      {directions.entrance_note ? <p className="type-caption">{directions.entrance_note}</p> : null}
      {mapUrl ? (
        <p>
          <a className="viewing-map" href={mapUrl} target="_blank" rel="noreferrer">
            Open map directions ↗
          </a>
        </p>
      ) : null}
    </section>
  );
}
