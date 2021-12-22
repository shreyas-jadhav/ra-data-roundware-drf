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

  revalidatingResources: string[] = [];

  constructor(
    apiUrl: string,
    httpClient: Function = fetchUtils.fetchJson,
    paginateAllByDefault = false
  ) {
    this.apiUrl = apiUrl;
    this.httpClient = httpClient;
    this.paginateAllByDefault = paginateAllByDefault;
    console.debug(`Data Provider created`)
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
    params: GetListParams,
    /** revalidates cache */
    revalidate = false
  ): Promise<GetListResult<RecordType>> {
    const { project_id, session_id, ...filters } = params.filter;
    console.debug(`getList`)

    /** get url query */
    let query = {
      ...getFilterQuery({
        project_id: project_id || this.currentProjectId,
        session_id,
        admin: 1,
        ...(filters.start_time__gte && {
          start_time__gte: filters.start_time__gte,
        }),
      }),
      ...getOrderingQuery(params.sort),
      // ...(paginate && getPaginationQuery(params.pagination)),
    };

    /** generate url */
    const url = `${this.apiUrl}/${resource}/?${stringify(query)}`;

    /** data to be returned */
    let json: any[] = [];
    const that = this;
    /** get resource from cached for that partifular project & sort by id */
    async function getFromCache() {
      json = [
        ...that.getResource(resource, params.filter.project_id)!,
      ].sort((a, b) => (a.id > b.id ? 1 : -1));
    }

    async function getFromNetwork() {

    /** add to revalidaitng resources array
     *  to avoid getting from network again if already happening
     */
      that.revalidatingResources.push(resource);
      ({ json } = await that.httpClient(url));
      json = that.normalizeApiResponse(json);


      /** filter events by project_id client side */
      if (resource == 'events') { 
        const sessions = that.getResource('sessions');
        console.log(`filtering events by session`)
        json = json.filter(e => sessions?.some(s => s.id == e.session_id));
      }

      /** save in cache */
      that.setResourse(resource, json, params.filter.project_id);

      /** remove frmo revalidating resources */
      that.revalidatingResources = that.revalidatingResources.filter(
        r => r !== resource
      );
    }


    

    /** if revalidate passed and not already revalidating */
    if (revalidate && !this.revalidatingResources.includes(resource)) {
      await getFromNetwork();
    } else if (
      /** if available in cache */
      Boolean(this.getResource(resource, params.filter.project_id)?.length)
    ) {
      await getFromCache();
      /** cache not available get from network */
    } else {
      await getFromNetwork();
      
    }


    /** resources from cache not filtered, do filtering client side */
    if (Object.keys(filters).length > 0) {
      Object.keys(filters).forEach(filter => {
        const start_time_key =
          resource == `sessions` ? `starttime` : `start_time`;
        switch (filter) {
          case `start_time__gte`:
            json = json.filter(
              d => new Date(d[start_time_key]) >= new Date(filters[filter])
            );
            break;
          case `start_time__lte`:
            json = json.filter(
              d => new Date(d[start_time_key]) <= new Date(filters[filter])
            );
            break;
          case `created__gte`:
            json = json.filter(
              d => new Date(d.created) >= new Date(filters[filter])
            );
            break;
          case `created__lte`:
            json = json.filter(
              d => new Date(d.created) <= new Date(filters[filter])
            );
            break;
            
          default:
            if (filter.slice(-5) == '__gte') {
              
              json = json.filter(d => {
                const res = d[filter.slice(0, -5)] >= filters[filter]
              
                return res
              })
              console.log(`res`, json)
            } else if (filter.slice(-5) == '__lte') {
              
              json = json.filter(d => d[filter.slice(0, -5)] <= filters[filter])
            } else if (filters[filter]) { 
              json = json.filter(d => d[filter] == filters[filter]);
              }
            break;
        }
      });
    }

    
    

    /** do sorting client side, resources from cache can't be sorted */
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

    /** do pagination client side, resources from cache can't be paginated */
    const total = json.length;
    const { page, perPage } = params.pagination;

    

    /** if page 0 and perPage 0 then understand that client doesn't want pagination */
    if (page > 0 && perPage > 0) {
      const start = page * perPage - perPage;
      const end = start + perPage;
      json = json.slice(start, end);
    }

    console.log(json)
    return {
      data: json,
      total: total,
    };
  }

  normalizeApiResponse(data: any[] | { results: any[] }) {
    return Array.isArray(data) ? data : data.results;
  }

  /** returns from cache if available else does new network req */
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
    console.debug(`getMany`, resource)
    return Promise.all(
      params.ids.map(id => this.getOneJson(resource, id))
    ).then(data => ({ data }));
  }

  
  async getManyReference<RecordType extends Record>(
    resource: string,
    params: GetManyReferenceParams,
    paginate: boolean = false
  ): Promise<GetManyReferenceResult<RecordType>> {
    console.debug(`getManyReferene`, resource)
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

    console.debug(`update`, resource)

    /** determine if any of the field has File type of data
     *  in that case we need to send form-data req
     */
    const needsFormData = Object.values(params?.data)?.some(
      v => v instanceof File || v instanceof Blob
    );

    /** generate form data type of object */
    if (needsFormData) {
      params.data = this.getFormData(params.data);
    }

    /** dynamiclly remove application/json header in case of formdata */
    await this.httpClient(`${this.apiUrl}/${resource}/${params.id}/`, {
      method: 'PATCH',
      body:
        params.data instanceof FormData
          ? params.data
          : JSON.stringify(params.data),
      ...(needsFormData && {
        headers: new Headers({}),
      }),
    });

    /** make new request for latest object */
    const newData = await this.getOneJson(resource, params.id, {
      admin: 1,
    }, true);

    /** discard previous record from cache */
    const newList = this.getResource(resource, this.currentProjectId)?.filter(
      r => r.id != params.id
    );

    /** push newly fetched record to cache */
    if (Array.isArray(newList)) {
      newList.push(newData);
      this.setResourse(resource, newList, this.currentProjectId);
    } else  {

      /** list not available yet then do a new req */
      this.getList(
        resource,
        {
          filter: {},
          sort: {
            field: 'id',
            order: 'ASC',
          },
          pagination: {
            page: 0,
            perPage: 0,
          },
        },
        true
      );
    }
    return { data: newData };
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
    params.data.project_id = this.currentProjectId;
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

    /** make new request for latest object with admin params */
    const newData = await this.getOneJson(resource, json.id, {
      admin: 1,
    }, true);

    
    const cachedList = this.getResource(resource, this.currentProjectId);

    /** push newly fetched record to cache */
    if (Array.isArray(cachedList)) {
      cachedList.push(newData);
      this.setResourse(resource, cachedList, this.currentProjectId);
    } else  {

      /** list not available yet then do a new req */
      this.getList(
        resource,
        {
          filter: {},
          sort: {
            field: 'id',
            order: 'ASC',
          },
          pagination: {
            page: 0,
            perPage: 0,
          },
        },
        true
      );
    }
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
      if (Array.isArray(list)) {
        list = list?.filter(r => params.ids.includes(r.id));
        this.setResourse(resource, list || [], this.currentProjectId);
      }
      return { data: responses.map(({ json }) => json.id) };
    });
  }

  getOneJson = async (
    resource: string,
    id: Identifier,
    filterQuery: FilterPayload = {},
    revalidate = false,
  ) => {
    if ([`projects`].includes(resource)) { 
      revalidate = true;
    }
    if (
      !revalidate && this.getResource(resource)?.some(d => d.id == id)
    ) {
      return this.getResource(resource)?.find(
        d => d.id == id
      );
    }
    // resources which require session_id
    if ([`projects`].includes(resource)) {
      filterQuery = {
        ...filterQuery,
        session_id: 1,
        admin: 1
      };
}
    let results = await this.httpClient(
      `${this.apiUrl}/${resource}/${id}/?${stringify(
        getFilterQuery(filterQuery)
      )}`
    ).then((response: Response) => response.json);

    if (revalidate) return results;
    
    const resourceArray = this.getResource(resource, this.currentProjectId);

    if (!resourceArray?.length) {
      this.getList(resource, {
        filter: {},
        pagination: {
          page: 0,
          perPage: 0,
        },
        sort: {
          field: 'id',
          order: "ASC"
        }
      })
    } else if (
      !resourceArray.some(r => r.id == results.id)
    ) {
      resourceArray.push(results);
      resourceArray.sort((a, b) => (a.id > b.id ? 1 : -1));
    }

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
