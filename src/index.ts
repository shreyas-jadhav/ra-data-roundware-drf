import { stringify } from 'query-string';
import {
  Identifier,
  Pagination,
  Sort,
  Filter,
  fetchUtils,
  DataProvider,
  GetListParams,
  GetListResult,
  GetManyReferenceParams,
  GetManyReferenceResult,
} from 'ra-core';

export {
  default as tokenAuthProvider,
  fetchJsonWithAuthToken,
} from './tokenAuthProvider';

const getPaginationQuery = (pagination: Pagination) => {
  return {
    page: pagination.page,
    page_size: pagination.perPage,
    paginate: true
  };
};

const getFilterQuery = (filter: Filter) => {
  const { q: search, ...otherSearchParams } = filter;
  return {
    ...otherSearchParams,
    search,
  };
};

export const getOrderingQuery = (sort: Sort) => {
  const { field, order } = sort;
  return {
    ordering: `${order === 'ASC' ? '' : '-'}${field}`,
  };
};

export interface CustomDataProvider extends DataProvider {
  getList: (resource: string, params: GetListParams, paginate?: boolean) => Promise<GetListResult>;
  getManyReference: (resource: string, params: GetManyReferenceParams, paginate?: boolean) => Promise<GetManyReferenceResult>;
}

export default (
  apiUrl: string,
  httpClient: Function = fetchUtils.fetchJson,
  paginateAllByDefault: boolean = false
): CustomDataProvider => {
  
  const getOneJson = (resource: string, id: Identifier, filterQuery: Filter = { }) =>
    httpClient(`${apiUrl}/${resource}/${id}/?${stringify(getFilterQuery(filterQuery))}`).then(
      (response: Response) => response.json
    );

  return {
    getList: async (resource, params, paginate: boolean = paginateAllByDefault) => {
      if ([`assets`].includes(resource)) paginate = true;
      let query = {
        ...getFilterQuery(params.filter),
        ...getOrderingQuery(params.sort),
        ...(paginate && getPaginationQuery(params.pagination))
      };
      
      const url = `${apiUrl}/${resource}/?${stringify(query)}`;

      const { json } = await httpClient(url);

      return {
        data: paginate ? json.results  : json,
        total: paginate ? json.count : json.length,
      };
    },

    getOne: async (resource, { id, ...query }) => {

      // resources which require session_id
      if ([`projects`].includes(resource)) query = {
        ...query,
        session_id: 1
      }
      const data = await getOneJson(resource, id, query);
      return {
        data,
      };
    },

    getMany: (resource, params) => {
      return Promise.all(
        params.ids.map(id => getOneJson(resource, id))
      ).then(data => ({ data }));
    },

    getManyReference: async (resource, params, paginate: boolean = paginateAllByDefault) => {
      let query = {
        ...getFilterQuery(params.filter),
        ...(paginate && getPaginationQuery(params.pagination)),
        ...getOrderingQuery(params.sort),
        [params.target]: params.id,
      };

      const url = `${apiUrl}/${resource}/?${stringify(query)}`;

      const { json } = await httpClient(url);
      return {
        data: paginate ? json.results : json,
        total: paginate ? json.count : json?.length,
      };
    },

    update: async (resource, params) => {
      const { json } = await httpClient(`${apiUrl}/${resource}/${params.id}/`, {
        method: 'PATCH',
        body: JSON.stringify(params.data),
      });
      return { data: json };
    },

    updateMany: (resource, params) =>
      Promise.all(
        params.ids.map(id =>
          httpClient(`${apiUrl}/${resource}/${id}/`, {
            method: 'PATCH',
            body: JSON.stringify(params.data),
          })
        )
      ).then(responses => ({ data: responses.map(({ json }) => json.id) })),

    create: async (resource, params) => {
      const { json } = await httpClient(`${apiUrl}/${resource}/`, {
        method: 'POST',
        body: JSON.stringify(params.data),
      });
      return {
        data: { ...json },
      };
    },

    delete: (resource, params) =>
      httpClient(`${apiUrl}/${resource}/${params.id}/`, {
        method: 'DELETE',
      }).then(() => ({ data: params.previousData })),

    deleteMany: (resource, params) =>
      Promise.all(
        params.ids.map(id =>
          httpClient(`${apiUrl}/${resource}/${id}/`, {
            method: 'DELETE',
          })
        )
      ).then(responses => ({ data: responses.map(({ json }) => json.id) })),
  };
};
