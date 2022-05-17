import { createDispatcher, createBuilder, createCommand, createClient, sleep } from "../../utils";
import { resetInterceptors, startServer, stopServer } from "../../server";
import { createRequestInterceptor } from "../../server/server";

describe("Dispatcher [ Queue ]", () => {
  const clientSpy = jest.fn();

  let client = createClient({ callback: clientSpy });
  let builder = createBuilder().setClient(() => client);
  let dispatcher = createDispatcher(builder);

  beforeAll(() => {
    startServer();
  });

  beforeEach(() => {
    client = createClient({ callback: clientSpy });
    builder = createBuilder().setClient(() => client);
    dispatcher = createDispatcher(builder);
    resetInterceptors();
    jest.resetAllMocks();
  });

  afterAll(() => {
    stopServer();
  });

  describe("When using dispatcher add method", () => {
    it("should add request to the dispatcher storage and trigger it", async () => {
      const command = createCommand(builder);
      createRequestInterceptor(command);

      const loadingSpy = jest.fn();
      dispatcher.events.onLoading(command.queueKey, loadingSpy);
      const requestId = dispatcher.add(command);

      expect(requestId).toBeString();
      expect(clientSpy).toBeCalledTimes(1);
      expect(loadingSpy).toBeCalledTimes(1);
      expect(dispatcher.getQueueRequestCount(command.queueKey)).toBe(1);
    });
    it("should add running request and delete it once data is fetched", async () => {
      const command = createCommand(builder);
      createRequestInterceptor(command, { delay: 1 });

      dispatcher.add(command);

      expect(dispatcher.getAllRunningRequest()).toHaveLength(1);
      await sleep(30);
      expect(dispatcher.getAllRunningRequest()).toHaveLength(0);
      expect(dispatcher.getQueue(command.queueKey).requests).toHaveLength(0);
    });
    it("should deduplicate requests and return ongoing requestId", async () => {
      const command = createCommand(builder, { deduplicate: true });
      createRequestInterceptor(command);

      const spy = jest.spyOn(dispatcher, "performRequest");

      const requestId = dispatcher.add(command);
      const deduplicatedId = dispatcher.add(command);

      expect(requestId).toBe(deduplicatedId);
      expect(spy).toBeCalledTimes(1);
      expect(dispatcher.getAllRunningRequest()).toHaveLength(1);
    });
    it("should queue the non-concurrent request", async () => {
      const command = createCommand(builder, { concurrent: false });
      createRequestInterceptor(command);

      const spy = jest.spyOn(dispatcher, "flushQueue");

      dispatcher.add(command);
      dispatcher.add(command);

      expect(spy).toBeCalledTimes(2);
      expect(dispatcher.getAllRunningRequest()).toHaveLength(1);
    });
    it("should send all concurrent request", async () => {
      const command = createCommand(builder, { concurrent: true });
      createRequestInterceptor(command);

      const spy = jest.spyOn(dispatcher, "performRequest");

      dispatcher.add(command);
      dispatcher.add(command);

      expect(spy).toBeCalledTimes(2);
      expect(dispatcher.getAllRunningRequest()).toHaveLength(2);
    });
    it("should send one request in cancel mode", async () => {
      const command = createCommand(builder, { cancelable: true });
      createRequestInterceptor(command);

      const spy = jest.spyOn(dispatcher, "performRequest");

      dispatcher.add(command);
      dispatcher.add(command);

      expect(spy).toBeCalledTimes(2);
      expect(dispatcher.getAllRunningRequest()).toHaveLength(1);
    });
    describe("When using dispatcher performRequest method", () => {
      it("should trigger fetch client", async () => {
        const command = createCommand(builder);
        createRequestInterceptor(command);

        const spy = jest.spyOn(builder, "client");
        const storageElement = dispatcher.createStorageElement(command);
        dispatcher.performRequest(storageElement);

        expect(spy).toBeCalledTimes(1);
      });
      it("should not trigger fetch client when app is offline", async () => {
        const command = createCommand(builder);
        createRequestInterceptor(command);

        builder.appManager.setOnline(false);
        const spy = jest.spyOn(builder, "client");
        const storageElement = dispatcher.createStorageElement(command);
        dispatcher.performRequest(storageElement);

        expect(spy).toBeCalledTimes(0);
      });
      it("should not trigger one storage element two times at the same time", async () => {
        const command = createCommand(builder);
        createRequestInterceptor(command);

        const spy = jest.spyOn(builder, "client");
        const storageElement = dispatcher.createStorageElement(command);
        dispatcher.performRequest(storageElement);
        dispatcher.performRequest(storageElement);

        expect(spy).toBeCalledTimes(1);
      });
    });
    describe("When retrying requests", () => {
      it("should retry failed request", async () => {
        const command = createCommand(builder, { retry: 1, retryTime: 0 });
        createRequestInterceptor(command, { status: 400, delay: 0 });

        const spy = jest.spyOn(builder, "client");
        dispatcher.add(command);

        await sleep(50);

        expect(spy).toBeCalledTimes(2);
      });
      it("should retry multiple times", async () => {
        const command = createCommand(builder, { retry: 2, retryTime: 0 });
        createRequestInterceptor(command, { status: 400, delay: 0 });

        const spy = jest.spyOn(builder, "client");
        dispatcher.add(command);

        await sleep(50);

        expect(spy).toBeCalledTimes(3);
      });
      it("should not retry failed request when command 'retry' option is disabled", async () => {
        const command = createCommand(builder, { retry: false });
        createRequestInterceptor(command, { status: 400, delay: 0 });

        const spy = jest.spyOn(builder, "client");
        dispatcher.add(command);

        await sleep(40);

        expect(spy).toBeCalledTimes(1);
      });
    });
  });
});
