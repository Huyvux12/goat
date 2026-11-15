import { GraphQLClientError } from "effect/graphql";

const isGraphQlClientError = (error: unknown): error is GraphQLClientError.GraphQLClientError =>
  GraphQLClientError.isGraphQLClientError(error);

export const isRefusedRequestedReviewersOnly = (error: unknown): boolean =>
  isGraphQlClientError(error) &&
  error.reason._tag === "ResponseError" &&
  error.reason.status === 200 &&
  error.reason.errors.every(
    ({ path, type }) =>
      type === "FORBIDDEN" &&
      path?.length === 6 &&
      path[0] === "repository" &&
      path[1] === "pullRequest" &&
      path[2] === "reviewRequests" &&
      path[3] === "nodes" &&
      typeof path[4] === "number" &&
      Number.isInteger(path[4]) &&
      path[4] >= 0 &&
      path[5] === "requestedReviewer",
  );
