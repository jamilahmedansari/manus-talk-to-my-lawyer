import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { enforceProcedure, PROCEDURE_POLICY, type ProcedureKey } from "./procedurePolicy";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/**
 * Policy-driven procedure factory.
 * Looks up the procedure key in PROCEDURE_POLICY and auto-enforces auth + role.
 *
 * Usage:
 *   submit: policyProcedure("letters.submit").input(...).mutation(...)
 */
export const policyProcedure = (key: ProcedureKey) => {
  const p = PROCEDURE_POLICY[key];
  const base = p.auth === "public" ? publicProcedure : protectedProcedure;

  return base.use(
    t.middleware(async (opts) => {
      enforceProcedure(opts.ctx, key);
      return opts.next();
    }),
  );
};
