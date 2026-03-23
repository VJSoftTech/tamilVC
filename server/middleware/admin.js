export function adminOnly(req, res, next) {
  if (req.user?.userType !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}
