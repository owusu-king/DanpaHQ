import { ScrollView } from "react-native";
import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { IndexGround } from "@/components/account/IndexRows";
import { SupportInbox } from "@/components/support/SupportInbox";
import { space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
export default function SupportTicketsScreen() {
  const { state } = useAuth();
  const bottom = useSafeBottom(space[12]);
  if (state.status !== "signed_in") return <AuthPrompt title="Support Tickets" body="Sign in to get help from Management." next="/(app)/support-tickets" />;
  return <IndexGround><ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: bottom }}><SupportInbox /></ScrollView></IndexGround>;
}
