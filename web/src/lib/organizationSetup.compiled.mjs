export const ORGANIZATION_ACTIVITY_OPTIONS = [
  { value: "residential", label: "Residential property" },
  { value: "commercial", label: "Commercial property" },
  { value: "hostel", label: "Student hostel" },
];

export function toggleOrganizationActivity(current, activity) {
  return current.includes(activity)
    ? current.filter((item) => item !== activity)
    : [...current, activity];
}
