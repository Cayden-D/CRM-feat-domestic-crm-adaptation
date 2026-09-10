export async function requireAuth(request, reply) {
    try {
        await request.jwtVerify();
        request.authUser = request.user;
    }
    catch {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: '登录已失效，请重新登录。' });
    }
}
export function hasPermission(granted, required) {
    if (granted.includes('*') || granted.includes(required))
        return true;
    return granted.includes(`${required.split(':')[0]}:*`);
}
export function requirePermission(permission) {
    return async (request, reply) => {
        await requireAuth(request, reply);
        if (reply.sent)
            return;
        if (!hasPermission(request.authUser.permissions, permission)) {
            return reply.code(403).send({ error: 'FORBIDDEN', message: '当前账号没有执行此操作的权限。' });
        }
    };
}
