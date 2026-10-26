import type { OrganizationActivity } from "./console";

export const ORGANIZATION_ACTIVITY_OPTIONS: ReadonlyArray<{
  value: OrganizationActivity;
  label: string;
}> = [
  { value: "residential", label: "Residential property" },
  { value: "commercial", label: "Commercial property" },
  { value: "hostel", label: "Student hostel" },
];

export function toggleOrganizationActivity(
  current: OrganizationActivity[],
  activity: OrganizationActivity,
): OrganizationActivity[] {
  return current.includes(activity)
    ? current.filter((item) => item !== activity)
    : [...current, activity];
}
