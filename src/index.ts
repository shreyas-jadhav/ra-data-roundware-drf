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

  cachedProjectData = new Map<number, Map<string, any[]>>();

  constructor(
    apiUrl: string,
    httpClient: Function = fetchUtils.fetchJson,
    paginateAllByDefault = false
  ) {
    this.apiUrl = apiUrl;
    this.httpClient = httpClient;
    this.paginateAllByDefault = paginateAllByDefault;
  }


  

  getResource(resource: string, projectId: number = 0): undefined | any[] {
    const resources = this.cachedProjectData.get(projectId)
    if (!resources) return;
    return resources.get(resource);
  }

  setResourse(resource: string, data: any[], projectId: number = 0) {
    let resources = this.cachedProjectData.get(projectId);
    if (!resources) resources = new Map<string, any[]>();
    resources.set(resource, data);
    this.cachedProjectData.set(projectId, resources);
  }


  /**
   *
   */
  async getList<RecordType extends Record = Record>(
    resource: string,
    params: GetListParams,
  ): Promise<GetListResult<RecordType>> {
    let query = {
      ...getFilterQuery(params.filter),
      ...getOrderingQuery(params.sort),
      // ...(paginate && getPaginationQuery(params.pagination)),
    };

    const url = `${this.apiUrl}/${resource}/?${stringify(query)}`;

    
    let json: any[];
    if (this.getResource(resource, params.filter.project_id)) json = this.getResource(resource, params.filter.project_id)!;
    else {
      console.log(`Fetching data...`, params.filter.project_id);
      ({ json } = await this.httpClient(url))
      json = this.normalizeApiResponse(json);
      this.setResourse(resource, json, params.filter.project_id);
    }

    const total = json.length;
    const { page, perPage } = params.pagination;
    
    if (page > 0 && perPage > 0) {
      const start = page * perPage - perPage;
      const end = start + perPage;
      json = json.slice(start, end)
      console.log(`Paginated`, page, perPage)
    }

    
    return {
      data: json,
      total: total,
    };
  }

  normalizeApiResponse(data: any[] | { results: any[] }) {
    return Array.isArray(data) ? data : data.results
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
    if (this.getResource(resource, filterQuery.project_id)?.some(d => d.id == id)) {
      return this.getResource(resource, filterQuery.project_id)?.find(d => d.id == id)
    }
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
    this.setResourse(resource, [...(this.getResource(resource, filterQuery.project_id) || []), results], filterQuery.project_id)
    return results;
  };
}
