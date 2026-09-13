import { layers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";

import type { MapConfig } from "@/lib/places";

/**
 * Rooomly's basemap.
 *
 * The map is context for the price markers, so it is quiet on purpose: the field
 * neutrals for ground, kola for parkland, a lagoon wash for water, white streets
 * with warm casings, and labels in the ink scale. Colour belongs to what a
 * tenant is choosing between; the ground under it should not compete. There are
 * no point-of-interest icons — here the listings are the points of interest.
 */
const ROOOMLY: Flavor = {
  ...namedFlavor("light"),
  background: "#EFEAE2",
  earth: "#F5F1EA",
  park_a: "#DCEADF",
  park_b: "#D1E4D6",
  wood_a: "#D6E6D5",
  wood_b: "#CBDFCA",
  scrub_a: "#E2ECDB",
  scrub_b: "#D8E6D1",
  glacier: "#F5F1EA",
  sand: "#EFE5CE",
  beach: "#F2E6C8",
  hospital: "#F3E5E1",
  school: "#EFE8D9",
  industrial: "#EAE5DD",
  aerodrome: "#E8E3DA",
  runway: "#DAD2C5",
  zoo: "#DCEADF",
  military: "#EAE4DA",
  pedestrian: "#F2EDE6",
  pier: "#E6E0D7",
  water: "#B9D2E6",
  buildings: "#E4DCD1",

  other: "#FFFFFF",
  minor_service: "#FFFFFF",
  minor_a: "#FFFFFF",
  minor_b: "#FFFFFF",
  link: "#FFFFFF",
  major: "#FFFFFF",
  highway: "#FDF1D6",
  minor_service_casing: "#E2DACE",
  minor_casing: "#E2DACE",
  link_casing: "#DAD1C4",
  major_casing_early: "#DAD1C4",
  major_casing_late: "#DAD1C4",
  highway_casing_early: "#E3CB8E",
  highway_casing_late: "#E3CB8E",
  bridges_other: "#FFFFFF",
  bridges_minor: "#FFFFFF",
  bridges_link: "#FFFFFF",
  bridges_major: "#FFFFFF",
  bridges_highway: "#FDF1D6",
  bridges_other_casing: "#D6CCBE",
  bridges_minor_casing: "#D6CCBE",
  bridges_link_casing: "#D6CCBE",
  bridges_major_casing: "#D6CCBE",
  bridges_highway_casing: "#DCC284",
  tunnel_other: "#F4F0EA",
  tunnel_minor: "#F4F0EA",
  tunnel_link: "#F4F0EA",
  tunnel_major: "#F4F0EA",
  tunnel_highway: "#F7EBD0",
  railway: "#C8BEB1",
  boundaries: "#B8AC9E",

  roads_label_minor: "#8A7D70",
  roads_label_minor_halo: "#FFFFFF",
  roads_label_major: "#6A5C50",
  roads_label_major_halo: "#FFFFFF",
  ocean_label: "#5E83A6",
  subplace_label: "#7A6B5E",
  subplace_label_halo: "#F5F1EA",
  city_label: "#33291F",
  city_label_halo: "#F5F1EA",
  state_label: "#A89A8C",
  state_label_halo: "#F5F1EA",
  country_label: "#A89A8C",
  address_label: "#A89A8C",
  address_label_halo: "#FFFFFF",

  regular: "Noto Sans Regular",
  bold: "Noto Sans Medium",
  italic: "Noto Sans Italic",
  pois: undefined,
};

export function rooomlyMapStyle(config: MapConfig): StyleSpecification {
  return {
    version: 8,
    glyphs: config.glyphs_url,
    sources: {
      protomaps: {
        type: "vector",
        url: config.tiles_url,
        attribution: config.attribution,
      },
    },
    layers: layers("protomaps", ROOOMLY, { lang: "en" }) as StyleSpecification["layers"],
  };
}
