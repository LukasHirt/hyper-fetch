import { FetchProgressType } from "client";
import { ClientProgressEvent, FetchCommandInstance, FetchCommandDump } from "command";
import { HttpMethodsEnum } from "constants/http.constants";
import { Dispatcher } from "dispatcher";
import { ExtractClientOptions, ExtractError } from "types";

export const stringifyKey = (value: unknown): string => {
  try {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    const data = JSON.stringify(value);
    if (typeof data !== "string") throw new Error();
    return data;
  } catch (_) {
    return "";
  }
};

export const getProgressValue = ({ loaded, total }: ClientProgressEvent): number => {
  if (!loaded || !total) return 0;
  return Number(((loaded * 100) / total).toFixed(0));
};

export const getRequestEta = (
  startDate: Date,
  progressDate: Date,
  { total, loaded }: ClientProgressEvent,
): { sizeLeft: number; timeLeft: number | null } => {
  const timeElapsed = +progressDate - +startDate || 1;
  const uploadSpeed = loaded / timeElapsed;
  const sizeLeft = total - loaded;
  const estimatedTimeValue = uploadSpeed ? sizeLeft / uploadSpeed : null;
  const timeLeft = total === loaded ? 0 : estimatedTimeValue;

  return { timeLeft, sizeLeft };
};

export const getProgressData = (
  requestStartTime: Date,
  progressDate: Date,
  progressEvent: ClientProgressEvent,
): FetchProgressType => {
  const { total, loaded } = progressEvent;
  if (Number.isNaN(total) || Number.isNaN(loaded)) {
    return {
      progress: 0,
      timeLeft: 0,
      sizeLeft: 0,
      total: 0,
      loaded: 0,
      startTimestamp: +requestStartTime,
    };
  }

  const { timeLeft, sizeLeft } = getRequestEta(requestStartTime, progressDate, progressEvent);

  return {
    progress: getProgressValue(progressEvent),
    timeLeft,
    sizeLeft,
    total,
    loaded,
    startTimestamp: +requestStartTime,
  };
};

// Keys
export const getAbortKey = (method: string, baseUrl: string, endpoint: string, cancelable: boolean): string => {
  return `${method}_${baseUrl}${endpoint}_${cancelable}`;
};

/**
 * Cache instance for individual command that collects individual requests responses from
 * the same endpoint (they may differ base on the custom key, endpoint params etc)
 * @param command
 * @returns
 */
export const getCommandKey = (
  command: FetchCommandInstance | FetchCommandDump<any>,
  useInitialValues?: boolean,
): string => {
  /**
   * Below stringified values allow to match the response by method, endpoint and query params.
   * That's because we have shared endpoint, but data with queryParams '?user=1' will not match regular request without queries.
   * We want both results to be cached in separate places to not override each other.
   *
   * Values to be stringified:
   *
   * endpoint: string;
   * queryParams: string;
   * params: string;
   */

  if ("values" in command) {
    const methodKey = stringifyKey(command.values.method);
    const endpointKey = useInitialValues ? command.commandOptions.endpoint : stringifyKey(command.values.endpoint);
    const queryParamsKey = useInitialValues ? "" : stringifyKey(command.values.queryParams);

    return `${methodKey}_${endpointKey}_${queryParamsKey}`;
  }
  const methodKey = stringifyKey(command.method);
  const endpointKey = useInitialValues ? command.options.endpoint : stringifyKey(command.endpoint);
  const queryParamsKey = useInitialValues ? "" : stringifyKey(command.queryParams);

  return `${methodKey}_${endpointKey}_${queryParamsKey}`;
};

export const getCommandDispatcher = <Command extends FetchCommandInstance>(
  command: Command,
  queueType: "auto" | "fetch" | "submit" = "auto",
): [Dispatcher<ExtractError<Command>, ExtractClientOptions<Command>>, boolean] => {
  const { fetchDispatcher, submitDispatcher } = command.builder;
  const isGet = command.method === HttpMethodsEnum.get;
  const isFetchDispatcher = (queueType === "auto" && isGet) || queueType === "fetch";
  const queue = isFetchDispatcher ? fetchDispatcher : submitDispatcher;

  return [queue, isFetchDispatcher];
};
