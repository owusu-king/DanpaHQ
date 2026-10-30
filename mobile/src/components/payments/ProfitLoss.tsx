import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Type, space } from "@/components/ui";
import { formatMinor } from "@/listings";
import type { PortfolioSummary } from "@/organizations";
import { theme } from "@/theme";
import { GraReport } from "./GraReport";

export function ProfitLoss({ report, organizationId, organizationName = "", properties = [] }: { report: PortfolioSummary["profit_loss"]; organizationId?: string; organizationName?: string; properties?: { id: string; title: string }[] }) {
  const [currency, setCurrency] = useState("GHS");
  if (!report) return <Type variant="caption">Refresh Finance to load your Profit &amp; Loss ledger.</Type>;
  const ledger = report.ledgers.find(row => row.currency === currency) ?? report.ledgers[0];
  if (!ledger) return null;
  const money = (minor: number) => formatMinor(minor, ledger.currency);
  return <View style={{ gap: space[5], paddingVertical: space[5] }}>
    <Type variant="title1">Profit &amp; Loss</Type><Type variant="caption">All recorded periods · Cash basis · {ledger.currency}</Type>
    {organizationId ? <GraReport key={organizationId} organizationId={organizationId} organizationName={organizationName} properties={properties} /> : null}
    {report.ledgers.length > 1 ? <ScrollView horizontal>{report.ledgers.map(row => <Pressable key={row.currency} accessibilityRole="button" onPress={() => setCurrency(row.currency)} style={{ padding: space[3] }}><Type variant="bodyStrong">{row.currency}</Type></Pressable>)}</ScrollView> : null}
    {[["Net rent revenue", ledger.revenue_minor - ledger.refunds_minor], ["Total expenses", ledger.expenses_minor + ledger.fees_minor], [ledger.profit_minor < 0 ? "Net loss" : "Net profit", ledger.profit_minor]].map(([label, amount]) => <View key={label} style={{ paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: theme.color.field["200"], gap: space[2] }}><Type variant="caption">{label}</Type><Type variant="amountLg" style={{ color: Number(amount) < 0 ? theme.color.laterite["600"] : theme.color.kola["600"] }}>{money(Number(amount))}</Type></View>)}
    <ScrollView horizontal accessibilityLabel="Monthly profit and loss ledger"><View>
      <View style={{ flexDirection: "row" }}>{["Month", "Rent received", "Refunds", "Expenses", "Fees", "Profit / loss"].map(label => <Type key={label} variant="captionStrong" style={{ width: 130, padding: space[3] }}>{label}</Type>)}</View>
      {ledger.monthly.map(row => <View key={row.period} style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}>{[row.period, money(row.revenue_minor), money(row.refunds_minor), money(row.expenses_minor), money(row.fees_minor), money(row.profit_minor)].map((value, index) => <Type key={index} variant="caption" style={{ width: 130, padding: space[3] }}>{value}</Type>)}</View>)}
    </View></ScrollView>
    {!ledger.monthly.length ? <Type variant="caption">Your ledger begins with confirmed rent or a recorded expense.</Type> : null}
    <Type variant="caption">Payouts are transfers, not additional income. Completed refunds reduce the original rent-receipt month. Expenses include recorded property costs and settled processing fees.</Type>
  </View>;
}
