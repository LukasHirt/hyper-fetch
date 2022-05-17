import { useRef } from "react";
import { useDidUpdate } from "@better-typed/react-lifecycle-hooks";

import { FetchCommandInstance, FetchCommand, getCommandKey } from "@better-typed/hyper-fetch";

import { useDebounce } from "utils/use-debounce";
import { isStaleCacheData } from "utils";
import { UseFetchOptionsType, UseFetchReturnType, useFetchDefaultOptions } from "use-fetch";
import { useCommandState } from "utils/use-command-state";

export const useFetch = <T extends FetchCommandInstance>(
  command: T,
  {
    dependencies = useFetchDefaultOptions.dependencies,
    disabled = useFetchDefaultOptions.disabled,
    dependencyTracking = useFetchDefaultOptions.dependencyTracking,
    revalidateOnMount = useFetchDefaultOptions.revalidateOnMount,
    initialData = useFetchDefaultOptions.initialData,
    refresh = useFetchDefaultOptions.refresh,
    refreshTime = useFetchDefaultOptions.refreshTime,
    refreshBlurred = useFetchDefaultOptions.refreshBlurred,
    refreshOnTabBlur = useFetchDefaultOptions.refreshOnTabBlur,
    refreshOnTabFocus = useFetchDefaultOptions.refreshOnTabFocus,
    refreshOnReconnect = useFetchDefaultOptions.refreshOnReconnect,
    debounce = useFetchDefaultOptions.debounce,
    debounceTime = useFetchDefaultOptions.debounceTime,
    deepCompare = useFetchDefaultOptions.deepCompare,
  }: UseFetchOptionsType<T> = useFetchDefaultOptions,
): UseFetchReturnType<T> => {
  const { cacheTime, cacheKey, queueKey, builder } = command;
  const { cache, fetchDispatcher, appManager, loggerManager } = builder;
  const commandDump = command.dump();
  const logger = useRef(loggerManager.init("useFetch")).current;
  const unmountCallbacks = useRef<null | VoidFunction>(null);

  const [state, actions, { setRenderKey, initialized }] = useCommandState({
    command,
    queue: fetchDispatcher,
    dependencyTracking,
    initialData,
    logger,
    deepCompare,
    commandListeners: [],
    removeCommandListener: () => null,
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    refresh: handleRefresh,
  });

  const requestDebounce = useDebounce(debounceTime);
  const refreshDebounce = useDebounce(refreshTime);

  const handleFetch = () => {
    /**
     * We can fetch when data is not stale or we don't have data at all
     * The exception is made for refreshing which should be triggered no matter if data is fresh or not
     * That's because cache time gives the details if the INITIAL call should be made, refresh works without limits
     */
    if (!disabled) {
      logger.debug(`Adding request to fetch queue`);
      fetchDispatcher.add(command);
    } else {
      logger.debug(`Cannot add to fetch queue`, { disabled });
    }
  };

  function handleRefresh() {
    if (refresh) {
      refreshDebounce.resetDebounce();
      logger.debug(`Starting refresh counter, request will be send in ${refreshTime}ms`);
      refreshDebounce.debounce(() => {
        const isBlur = !appManager.isFocused;

        // If window tab is not active should we refresh the cache
        const canRefreshBlurred = isBlur && refreshBlurred;
        const isFetching = !!fetchDispatcher.getRunningRequests(command.queueKey).length;
        const isQueued = !!fetchDispatcher.getQueue(command.queueKey)?.requests.length;
        const canRefresh = canRefreshBlurred || !isBlur || !isFetching || !isQueued;

        if (canRefresh) {
          logger.debug(`Performing refresh request`, {
            canRefresh,
            isFocused: appManager.isFocused,
          });

          handleFetch();
        } else {
          logger.debug(`Cannot trigger refresh request`, {
            canRefresh,
            isFocused: appManager.isFocused,
          });
        }
        handleRefresh();
      });
    }
  }

  const handleRevalidate = () => {
    handleFetch();
  };

  const refreshFn = (invalidateKey?: string | FetchCommandInstance | RegExp) => {
    if (invalidateKey && invalidateKey instanceof FetchCommand) {
      cache.events.revalidate(`/${getCommandKey(invalidateKey, true)}/`);
    } else if (invalidateKey) {
      cache.events.revalidate(invalidateKey);
    } else {
      handleRevalidate();
    }
  };

  const abort = () => {
    command.abort();
  };

  const handleMountEvents = () => {
    const focusUnmount = appManager.events.onFocus(() => {
      if (refreshOnTabFocus) handleFetch();
      handleRefresh();
    });
    const blurUnmount = appManager.events.onBlur(() => {
      if (refreshOnTabBlur) handleFetch();
      handleRefresh();
    });
    const onlineUnmount = appManager.events.onOnline(() => {
      if (refreshOnReconnect) handleFetch();
      handleRefresh();
    });
    const offlineUnmount = builder.appManager.events.onOffline(() => {
      handleRefresh();
    });

    const revalidateUnmount = cache.events.onRevalidate(cacheKey, handleRevalidate);

    const unmount = () => {
      focusUnmount();
      blurUnmount();
      onlineUnmount();
      offlineUnmount();
      revalidateUnmount();
    };

    unmountCallbacks.current?.();
    unmountCallbacks.current = unmount;

    return unmount;
  };

  /**
   * Initial fetch triggered once data is stale or we use the revalidate strategy
   */
  useDidUpdate(() => {
    const hasStaleData = initialized && isStaleCacheData(cacheTime, state.timestamp);
    if (revalidateOnMount || hasStaleData) {
      handleFetch();
    }
  }, [initialized]);

  /**
   * Initialization of the events related to data exchange with cache and queue
   * This allow to share the state with other hooks and keep it related
   */
  useDidUpdate(handleMountEvents, [JSON.stringify(commandDump)], true);

  /**
   * Fetching logic for updates handling
   */
  useDidUpdate(() => {
    /**
     * While debouncing we need to make sure that first request is not debounced when the cache is not available
     * This way it will not wait for debouncing but fetch data right away
     */
    if (!fetchDispatcher.getQueueRequestCount(queueKey) && debounce) {
      logger.debug("Debouncing request", { queueKey, command });
      requestDebounce.debounce(() => handleFetch());
    } else {
      handleFetch();
    }
  }, [JSON.stringify(commandDump), ...dependencies, disabled]);

  useDidUpdate(
    () => {
      handleRefresh();
    },
    [JSON.stringify(commandDump), ...dependencies, disabled, refresh, refreshTime],
    true,
  );

  return {
    get data() {
      setRenderKey("data");
      return state.data;
    },
    get error() {
      setRenderKey("error");
      return state.error;
    },
    get loading() {
      setRenderKey("loading");
      return state.loading;
    },
    get status() {
      setRenderKey("status");
      return state.status;
    },
    get isRefreshed() {
      setRenderKey("isRefreshed");
      return state.isRefreshed;
    },
    get retries() {
      setRenderKey("retries");
      return state.retries;
    },
    get timestamp() {
      setRenderKey("timestamp");
      return state.timestamp;
    },
    get isOnline() {
      setRenderKey("isOnline");
      return state.isOnline;
    },
    get isFocused() {
      setRenderKey("isFocused");
      return state.isFocused;
    },
    get isRefreshingError() {
      setRenderKey("error");
      setRenderKey("isRefreshed");
      return !!state.error && state.isRefreshed;
    },
    get isStale() {
      setRenderKey("timestamp");
      return isStaleCacheData(cacheTime, state.timestamp);
    },
    ...actions,
    isDebouncing: requestDebounce.active,
    refresh: refreshFn,
    abort,
  };
};
