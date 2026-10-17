import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

export function isUserRejection(error: unknown): boolean {
  if (error instanceof BaseError) {
    return Boolean(error.walk((e) => e instanceof UserRejectedRequestError || (e as { code?: number }).code === 4001));
  }
  return false;
}

export function errorMessage(error: unknown): string {
  if (isUserRejection(error)) return "Cancelled in your wallet";
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) {
      return `The contract rejected this (${revert.data.errorName})`;
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : "Something went wrong";
}
