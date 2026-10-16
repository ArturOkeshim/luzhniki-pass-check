export type SubscriptionStatus = "active" | "expired" | "future";

export type Subscription = {
  plate: string;
  dateFrom: string;
  dateTo: string;
  tariffName: string;
  accessPeriod: string;
  status: SubscriptionStatus;
};

export type PlateCheckStatus = SubscriptionStatus | "none";

export type PlateCheck = {
  plate: string;
  status: PlateCheckStatus;
  dateFrom: string | null;
  dateTo: string | null;
  tariffName: string | null;
  accessPeriod: string | null;
  hasFine: boolean;
};

