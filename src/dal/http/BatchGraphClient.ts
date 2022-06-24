import { ArrayUtilities } from "../../utils/ArrayUtilities";
import { IHttpClient, IHttpClientResponse } from "./IHttpClient";
import { BatchHandler } from "./BatchHandler";

/**
 * A graph client which will automatically batch not awaited get calls.
 * To get most of it You can either pass this client to multiple components and await get calls in them.
 * Alternatively You can use Promise.all([client.get("/me"), client.get("/me/photo/$value"),client.get("/me/presence")]).
 */
export class BatchGraphClient implements IHttpClient {
    private batch: {
        id: string;
        url: string;
        method: "GET";
        headers: any;
    }[] = [];
    private registeredPromises: Map<string, { resolve, error }[]> = new Map<string, { resolve, error }[]>();
    /**
     * Initializes new instance of BatchGraphClient.
     * @param baseClient base client that will handle actual calls to Graph API.
     * @param batchWaitTime the number of milliseconds to wait between batching. Defaults to 500. 
     * @param batchSplitThreshold the maximum number of calls in a single batch. Defaults to 15. 
     */
    constructor(protected baseClient: IHttpClient, public batchWaitTime = 500, public batchSplitThreshold = 15) {
    }
    public get(url: string, options?): Promise<IHttpClientResponse> {
        return new Promise<IHttpClientResponse>((resolve, error) => {
            this.createGetBatchRequest(url, { resolve, error });
        });
    }
    public post(url: string, options?): Promise<IHttpClientResponse> {
        return this.baseClient.post(url, options);
    }
    public patch(url: string, options?): Promise<IHttpClientResponse> {
        return this.baseClient.patch(url, options);
    }
    public put(url: string, options?): Promise<IHttpClientResponse> {
        return this.baseClient.put(url, options);
    }
    public delete(url: string): Promise<IHttpClientResponse> {
        return this.baseClient.delete(url);
    }
    protected generateBatch = async () => {
        const requestBatch = [...this.batch];
        this.batch = [];
        const requestPromises = new Map<string, { resolve, error }[]>(this.registeredPromises as any);

        this.registeredPromises.clear();
        //As there is an limit to max batch size (15) let's split our request to sub batches we will run sequentially
        let batches = ArrayUtilities.splitToMaxLength(requestBatch, this.batchSplitThreshold);
        for (const batch of batches) {
            let promisesToBeResolvedByCurrentBatch = ArrayUtilities.getSubMap(requestPromises, batch.map(b => b.id));
            const batchHandler = new BatchHandler(this.baseClient, promisesToBeResolvedByCurrentBatch, batch, BatchHandler.maxRetries);
            await batchHandler.executeBatch();
        }
    }
    public createGetBatchRequest = (url: string, requestPromise: { resolve, error }) => {
        if (this.batch.length === 0) {
            setTimeout(this.generateBatch, this.batchWaitTime);
        }
        let promiseId = encodeURIComponent(url);
        let apiUrl = new URL(url, "https://graph.microsoft.com");
        let relativeUrl = apiUrl.pathname + apiUrl.search;
        if (this.batch.filter(req => req.id === promiseId)[0]) {
            this.registeredPromises.get(promiseId).push(requestPromise);
        }
        else {
            this.batch.push({
                url: relativeUrl,
                id: promiseId,
                method: "GET",
                headers:{
                    "ConsistencyLevel":"eventual"
                }
            });
            this.registeredPromises.set(promiseId, [requestPromise]);
        }
    }
}