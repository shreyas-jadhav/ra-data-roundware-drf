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
  if (pagination.page === 0) return {};
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
  currentProjectId: number = 0;
  constructor(
    apiUrl: string,
    httpClient: Function = fetchUtils.fetchJson,
    paginateAllByDefault = false
  ) {
    this.apiUrl = apiUrl;
    this.httpClient = httpClient;
    this.paginateAllByDefault = paginateAllByDefault;
  }

  getResource(
    resource: string,
    projectId: number = this.currentProjectId
  ): undefined | any[] {
    const resources = this.cachedProjectData.get(projectId);

    if (!resources) return;
    return resources.get(resource);
  }

  setResourse(
    resource: string,
    data: any[],
    projectId: number = this.currentProjectId
  ) {
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
    params: GetListParams
  ): Promise<GetListResult<RecordType>> {
    const { project_id, session_id, ...filters } = params.filter;
    
    let query = {
      ...getFilterQuery({
        project_id: project_id || this.currentProjectId,
        session_id,
        ...(filters.start_time__gte && {
          start_time__gte: filters.start_time__gte,
        }),
      }),
      ...getOrderingQuery(params.sort),
      // ...(paginate && getPaginationQuery(params.pagination)),
    };

    const url = `${this.apiUrl}/${resource}/?${stringify(query)}`;

    let json: any[];
    if (this.getResource(resource, params.filter.project_id)) {
      json = [
        ...this.getResource(resource, params.filter.project_id)!,
      ].sort((a, b) => (a.id > b.id ? 1 : -1));
    } else {
      
      ({ json } = await this.httpClient(url));
      json = this.normalizeApiResponse(json);
      this.setResourse(resource, json, params.filter.project_id);
    }

    if (Object.keys(filters).length > 0) {
      Object.keys(filters).forEach(filter => {
        
        const start_time_key =
          resource == `sessions` ? `starttime` : `start_time`;
        switch (filter) {
          case `start_time__gte`:
            json = json.filter(
              d => new Date(d[start_time_key]) > new Date(filters[filter])
            );
            break;
          case `start_time__lte`:
            json = json.filter(
              d => new Date(d[start_time_key]) < new Date(filters[filter])
            );
            break;
          case `created__gte`:
            json = json.filter(
              d => new Date(d.created) > new Date(filters[filter])
            );
            break;
          case `created__lte`:
            json = json.filter(
              d => new Date(d.created) < new Date(filters[filter])
            );
            break;
          default:
            json = json.filter(d => d[filter] == filters[filter]);
            break;
        }
      });
    }

    const total = json.length;
    const { page, perPage } = params.pagination;

    if (params?.sort?.field) {
      const { field, order } = params.sort;
      json = json.sort((a, b) => {
        let bool = false;
        if (order == 'ASC') {
          a[field] > b[field] ? (bool = true) : (bool = false);
        } else a[field] > b[field] ? (bool = false) : (bool = true);
        if (bool) return 1;
        return -1;
      });
      
    }
    if (page > 0 && perPage > 0) {
      const start = page * perPage - perPage;
      const end = start + perPage;
      json = json.slice(start, end);
      
    }

    return {
      data: json,
      total: total,
    };
  }

  normalizeApiResponse(data: any[] | { results: any[] }) {
    return Array.isArray(data) ? data : data.results;
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
  async update<RecordType extends Record>(
    resource: string,
    params: UpdateParams
  ): Promise<UpdateResult<RecordType>> {
    
    const needsFormData = Object.values(params?.data)?.some(
      v => v instanceof File || v instanceof Blob
    );

    if (needsFormData) {
      params.data = this.getFormData(params.data);
    }
    const { json } = await this.httpClient(
      `${this.apiUrl}/${resource}/${params.id}/`,
      {
        method: 'PATCH',
        body:
          params.data instanceof FormData
            ? params.data
            : JSON.stringify(params.data),
        ...(needsFormData && {
          headers: new Headers({}),
        }),
      }
    );
    
    const newList = this.getResource(resource, this.currentProjectId)?.filter(
      r => r.id != params.id
    );
    if (Array.isArray(newList)) {
      newList.push(json);
      this.setResourse(resource, newList, this.currentProjectId);
      
    } else this.setResourse(resource, [json], this.currentProjectId);
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
  async create<RecordType extends Record>(
    resource: string,
    params: CreateParams
  ): Promise<CreateResult<RecordType>> {
    const needsFormData = Object.values(params?.data)?.some(
      v => v instanceof File || v instanceof Blob
    );
    if (needsFormData) {
      params.data = this.getFormData(params.data);
    }
    const { json } = await this.httpClient(`${this.apiUrl}/${resource}/`, {
      method: 'POST',
      body:
        params.data instanceof FormData
          ? params.data
          : JSON.stringify(params.data),
      ...(needsFormData && {
        headers: new Headers({}),
      }),
    });

    const resourseList = this.getResource(resource, this.currentProjectId);
    if (Array.isArray(resourseList)) resourseList?.push(json);
    else this.setResourse(resource, [json], this.currentProjectId);
    return {
      data: { ...json },
    };
  }
  async delete<RecordType extends Record>(
    resource: string,
    params: DeleteParams
  ): Promise<DeleteResult<RecordType>> {
    
    return this.httpClient(`${this.apiUrl}/${resource}/${params.id}/`, {
      method: 'DELETE',
    }).then(() => {
      let list = this.getResource(resource, this.currentProjectId);
      list = list?.filter(r => r.id != params.id);
      this.setResourse(resource, list || [], this.currentProjectId);
      return { data: params.previousData };
    });
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
    ).then(responses => {
      let list = this.getResource(resource);
      list = list?.filter(r => params.ids.includes(r.id));
      this.setResourse(resource, list || [], this.currentProjectId);
      return { data: responses.map(({ json }) => json.id) };
    });
  }

  getOneJson = async (
    resource: string,
    id: Identifier,
    filterQuery: FilterPayload = {}
  ) => {
    if (
      this.getResource(resource, filterQuery.project_id)?.some(d => d.id == id)
    ) {
      return this.getResource(resource, filterQuery.project_id)?.find(
        d => d.id == id
      );
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

    const resourceArray = this.getResource(resource, this.currentProjectId);
    if (
      Array.isArray(resourceArray) &&
      !resourceArray.some(r => r.id == results.id)
    ) {
      
      resourceArray.push(results);
      resourceArray.sort((a, b) => (a.id > b.id ? 1 : -1));
    } else this.setResourse(resource, [results], this.currentProjectId);

    return results;
  };

  getFormData(object: Object) {
    return this.objectToFormData(object);
  }

  objectToFormData(obj: Object, rootName?: string, ignoreList?: string[]) {
    var formData = new FormData();

    function appendFormData(data: Object, root: string = '') {
      if (!ignore(root)) {
        root = root || '';
        if (data instanceof File) {
          formData.append(root, data);
        } else if (Array.isArray(data)) {
          for (var i = 0; i < data.length; i++) {
            appendFormData(data[i] + ',', root);
          }
        } else if (typeof data === 'object' && data) {
          for (var key in data) {
            if (data.hasOwnProperty(key)) {
              if (root === '') {
                // @ts-ignore
                appendFormData(data[key], key);
              } else {
                // @ts-ignore
                appendFormData(data[key], root + '.' + key);
              }
            }
          }
        } else {
          if (data !== null && typeof data !== 'undefined') {
            formData.append(root, data);
          }
        }
      }
    }

    function ignore(root: string) {
      return (
        Array.isArray(ignoreList) &&
        ignoreList.some(function(x) {
          return x === root;
        })
      );
    }

    appendFormData(obj, rootName);

    return formData;
  }
}
