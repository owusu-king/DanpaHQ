# Ghana reference geography

This is the full obtained reference snapshot, not sample data. See
[import instructions and coverage](../../../docs/deployment.md#8-maps-and-ghana-reference-data).

The combined derived reference database is available under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Individual source contents retain these licences and attributions:

- Ghana Statistical Service; OCHA/HDX: [CC BY 3.0 IGO](https://creativecommons.org/licenses/by/3.0/igo/legalcode), [dataset](https://data.humdata.org/dataset/cod-ab-gha).
- Contains data from [GeoNames](https://www.geonames.org): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright): ODbL 1.0.

The snapshot includes normalized records, source identities, original facts,
aliases, coordinates, inferred parent status, and licensed district geometry.
`manifest.json` records archive checksums and counts. `admin-crosswalk.json`
records spelling equivalences and the evidence for the Guan supplement.
Raw archives and extraction intermediates are ignored and excluded from Docker
images. Direct GSS shapefiles are not redistributed: no explicit redistribution
licence was found in their archive.

The public `/api/v1/geo/dataset/` NDJSON offer contains source facts, licences,
and their canonical target IDs. It excludes private addresses, property pins,
and user-created address text. The import code and this complete snapshot allow
reproduction of the reference derivation. Keep this offer and the visible source
credits when deploying. Database licensing does not license application code.

No warranty of completeness, present-day administrative boundaries, or survey
accuracy is made. Missing/ambiguous parents remain unknown. Never substitute a
settlement centroid for the actual location of a property.
