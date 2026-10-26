declare module "@paystack/inline-js" {
  export type PaystackTransaction = {
    id: number;
    reference: string;
    message: string;
  };

  export type PaystackCallbacks = {
    onLoad?: (response: { id: number; accessCode: string; customer: unknown }) => void;
    onSuccess?: (response: PaystackTransaction) => void;
    onCancel?: () => void;
    onError?: (error: { message?: string }) => void;
  };

  export default class PaystackPop {
    resumeTransaction(accessCode: string, callbacks?: PaystackCallbacks): unknown;
  }
}
