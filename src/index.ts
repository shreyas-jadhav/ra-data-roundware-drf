import { stringify } from 'query-string';
import {
  Identifier,
  
  fetchUtils,
  DataProvider,
  GetListResult,
  GetManyReferenceParams,
  GetManyReferenceResult,
  CreateParams,
  CreateResult,
  DeleteManyParams,
  DeleteManyResult,
  DeleteParams,
  DeleteResult,
  GetManyParams,
  GetManyResult,
  GetOneParams,
  GetOneResult,
  UpdateManyParams,
  UpdateManyResult,
  UpdateParams,
  UpdateResult,
  FilterPayload,
  SortPayload,
  PaginationPayload,
  GetListParams,
  Record,
} from 'ra-core';

export {
  default as tokenAuthProvider,
  fetchJsonWithAuthToken,
} from './tokenAuthProvider';

const getPaginationQuery = (pagination: PaginationPayload) => {
  if(pagination.page === 0) return {}
  return {
    page: pagination.page,
    page_size: pagination.perPage,
    paginate: true,
  };
};

const getFilterQuery = (filter: FilterPayload) => {
  const { q: search, ...otherSearchParams } = filter;
  return {
    ...otherSearchParams,
    search,
  };
};

export const getOrderingQuery = (sort: SortPayload) => {
  const { field, order } = sort;
  return {
    ordering: `${order === 'ASC' ? '' : '-'}${field}`,
  };
};




/**
 *
 *
 * @export
 * @class RoundwareDataProvider
 * @implements {DataProvider}
 */
export class RoundwareDataProvider implements DataProvider {
  apiUrl: string;
  httpClient: Function;
  paginateAllByDefault: boolean;
  constructor(
    apiUrl: string,
    httpClient: Function = fetchUtils.fetchJson,
    paginateAllByDefault = false
  ) {
    this.apiUrl = apiUrl;
    this.httpClient = httpClient;
    this.paginateAllByDefault = paginateAllByDefault;
  }



  /**
   *
   */
  async getList<RecordType extends Record = Record>(
    resource: string,
    params: GetListParams,
    paginate: boolean = [`assets`].includes(resource) ||
      this.paginateAllByDefault
  ): Promise<GetListResult<RecordType>> {
    let query = {
      ...getFilterQuery(params.filter),
      ...getOrderingQuery(params.sort),
      ...(paginate && getPaginationQuery(params.pagination)),
      ...(this.isEligibleForCaching(params.filter) && this.getCachingQuery(resource)),
    };

    const url = `${this.apiUrl}/${resource}/?${stringify(query)}`;

    

    let { json } = await this.httpClient(url);
    
    json = this.normalizeApiResponse(json)
    

    this.isEligibleForCaching(params.filter) && (json = this.mergeWithCachedData<RecordType>(resource, json));

    return {
      data: json,
      total: json.length,
    };
  }

  normalizeApiResponse(data: any[] | { results: any[] }) {
    return Array.isArray(data) ? data : data.results
  }

  // if there is already a time filter then it should not be cached
  isEligibleForCaching(filter: FilterPayload) {
    return false // temporarily disabling caching
    let eligible = true;
    [`created__gte`, `created__lte`, `start_time__gte`, `start_time__lte`].forEach((k) => {
      if (k in filter) eligible = false;
    })
    return eligible
  }

  
  cachedResources = new Map<string, { lastFetched: Date, data: any[] }>();
  getCachingQuery(resource: string) {
    const cachedResource = this.cachedResources.get(resource);
    if (!cachedResource) return {};
    let query = {};

    switch (resource) {
      case `assets`:
        query = {
          created__gte: cachedResource.lastFetched.toISOString()
        }
        break;
    
      case `listenevents`:
        query = {
          start_time__gte: cachedResource.lastFetched.toISOString()
        }
        break;
      default:
        break;
    }
    return query;
  };

  mergeWithCachedData<RecordType extends Record>(resource: string, data: any[]): GetListResult<RecordType>["data"] {

    if (![`assets`, `listenevents`].includes(resource)) return data;
    const cachedResource = this.cachedResources.get(resource);

    if (!cachedResource) {
      this.cachedResources.set(resource, {
        lastFetched: new Date(),
        data,
      })
      return data;
    }
    const newData = cachedResource.data.concat(data);
    console.info(`used cached data for ${resource}`);
    this.cachedResources.set(resource, {
      lastFetched: new Date(),
      data: newData
    })
    return newData;
  }


  async getOne<RecordType extends Record>(
    resource: string,
    { id, ...query }: GetOneParams
  ): Promise<GetOneResult<RecordType>> {
    const data = await this.getOneJson(resource, id, query);
    return {
      data,
    };
  }
  async getMany<RecordType extends Record>(
    resource: string,
    params: GetManyParams
  ): Promise<GetManyResult<RecordType>> {
    return Promise.all(
      params.ids.map(id => this.getOneJson(resource, id))
    ).then(data => ({ data }));
  }
  async getManyReference<RecordType extends Record>(
    resource: string,
    params: GetManyReferenceParams,
    paginate: boolean = false
  ): Promise<GetManyReferenceResult<RecordType>> {
    let query = {
      ...getFilterQuery(params.filter),
      ...(paginate && getPaginationQuery(params.pagination)),
      ...getOrderingQuery(params.sort),
      [params.target]: params.id,
    };

    const url = `${this.apiUrl}/${resource}/?${stringify(query)}`;

    const { json } = await this.httpClient(url);
    return {
      data: paginate ? json.results : json,
      total: paginate ? json.count : json?.length,
    };
  }
  async update<RecordType extends Record>(resource: string, params: UpdateParams): Promise<UpdateResult<RecordType>> {
    const { json } = await this.httpClient(
      `${this.apiUrl}/${resource}/${params.id}/`,
      {
        method: 'PATCH',
        body: JSON.stringify(params.data),
      }
    );
    return { data: json };
  }
  async updateMany(
    resource: string,
    params: UpdateManyParams
  ): Promise<UpdateManyResult> {
    return Promise.all(
      params.ids.map(id =>
        this.httpClient(`${this.apiUrl}/${resource}/${id}/`, {
          method: 'PATCH',
          body: JSON.stringify(params.data),
        })
      )
    ).then(responses => ({ data: responses.map(({ json }) => json.id) }));
  }
  async create<RecordType extends Record>(resource: string, params: CreateParams): Promise<CreateResult<RecordType>> {
    const { json } = await this.httpClient(`${this.apiUrl}/${resource}/`, {
      method: 'POST',
      body: JSON.stringify(params.data),
    });
    return {
      data: { ...json },
    };
  }
  async delete<RecordType extends Record>(resource: string, params: DeleteParams): Promise<DeleteResult<RecordType>> {
    return this.httpClient(`${this.apiUrl}/${resource}/${params.id}/`, {
      method: 'DELETE',
    }).then(() => ({ data: params.previousData }));
  }
  async deleteMany(
    resource: string,
    params: DeleteManyParams
  ): Promise<DeleteManyResult> {
    return Promise.all(
      params.ids.map(id =>
        this.httpClient(`${this.apiUrl}/${resource}/${id}/`, {
          method: 'DELETE',
        })
      )
    ).then(responses => ({ data: responses.map(({ json }) => json.id) }));
  }

  getOneJson = async (
    resource: string,
    id: Identifier,
    filterQuery: FilterPayload = {}
  ) => {
    // resources which require session_id
    if ([`projects`].includes(resource))
      filterQuery = {
        ...filterQuery,
        session_id: 1,
      };

    let results = await this.httpClient(
      `${this.apiUrl}/${resource}/${id}/?${stringify(
        getFilterQuery(filterQuery)
      )}`
    ).then((response: Response) => response.json);

    return results;
  };
}
