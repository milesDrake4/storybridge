import type { UserId } from "@/contracts/domain/ids";

export type AuthenticatedMagicLinkIdentity = {
  email: string;
  userId: UserId;
};

export type MagicLinkExchange = {
  redeem(code: string): Promise<AuthenticatedMagicLinkIdentity>;
};

export type MagicLinkInvitationAcceptance = {
  acceptForIdentity(identity: AuthenticatedMagicLinkIdentity): Promise<void>;
};

export type CompleteMagicLinkDependencies = {
  exchange: MagicLinkExchange;
  invitations: MagicLinkInvitationAcceptance;
};

export async function completeMagicLink(
  code: string,
  dependencies: CompleteMagicLinkDependencies,
): Promise<void> {
  const identity = await dependencies.exchange.redeem(code);
  await dependencies.invitations.acceptForIdentity(identity);
}
