import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import SavedScreen from "../saved";

export default function SavedTab() {
  const { state } = useAuth();
  if (state.status !== "signed_in") {
    return <AuthPrompt title="Save your shortlist" body="Verify your phone once and your saved properties will follow you across devices." next="/(app)/(tabs)/saved" />;
  }
  return <SavedScreen />;
}
