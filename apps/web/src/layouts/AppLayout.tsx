import { Suspense, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import MenuIcon from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import LogoutIcon from '@mui/icons-material/Logout';
import KeyIcon from '@mui/icons-material/Key';
import { ChangePasswordDialog } from '../features/auth/ChangePasswordDialog';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { Loading } from '../components/Feedback';
import { useAuth } from '../store/auth';
import { NAV, VIEW_TRANSACTIONS } from '../routes/nav';
import { humanize } from '../utils/format';

const DRAWER = 248;

export function AppLayout() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuEl, setMenuEl] = useState<HTMLElement | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [search, setSearch] = useState('');

  const items = NAV.filter((n) => !n.any || can(...n.any));
  const drawer = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar sx={{ gap: 1 }}>
        <Box component="img" src="/favicon.svg" alt="" sx={{ width: 28, height: 28 }} />
        <Box>
          <Typography fontWeight={700} lineHeight={1.1}>
            Paragon
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Sales Approvals
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      {(['main', 'admin'] as const).map((group) => {
        const groupItems = items.filter((i) => i.group === group);
        if (!groupItems.length) return null;
        return (
          <List key={group} dense subheader={group === 'admin' ? <ListSubheader>Administration</ListSubheader> : undefined}>
            {groupItems.map((item) => (
              <ListItemButton
                key={item.path}
                component={NavLink}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                sx={{ mx: 1, borderRadius: 1, '&.active': { bgcolor: 'action.selected', color: 'primary.main', '& svg': { color: 'primary.main' } } }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            ))}
          </List>
        );
      })}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{ width: { md: `calc(100% - ${DRAWER}px)` }, ml: { md: `${DRAWER}px` }, borderBottom: 1, borderColor: 'divider' }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ display: { md: 'none' } }} aria-label="Open navigation">
            <MenuIcon />
          </IconButton>
          {can(...VIEW_TRANSACTIONS) && (
            <Box
              component="form"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/transactions?q=${encodeURIComponent(search.trim())}`);
              }}
              sx={{ flex: 1, maxWidth: 420 }}
            >
              <TextField
                placeholder="Search number, farmer, CV code, reference, amount…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Global transaction search"
                slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
              />
            </Box>
          )}
          <Box sx={{ flex: 1 }} />
          <NotificationBell />
          <Tooltip title="Account">
            <IconButton onClick={(e) => setMenuEl(e.currentTarget)} aria-label="Account menu">
              <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
                {user?.fullName
                  .split(' ')
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join('')}
              </Avatar>
            </IconButton>
          </Tooltip>
          <Menu anchorEl={menuEl} open={!!menuEl} onClose={() => setMenuEl(null)}>
            <Box sx={{ px: 2, py: 1 }}>
              <Typography fontWeight={600}>{user?.fullName}</Typography>
              <Typography variant="body2" color="text.secondary">
                {user?.email}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {user?.roles.map((r) => humanize(r.code)).join(', ')}
              </Typography>
            </Box>
            <Divider />
            <MenuItem
              onClick={() => {
                setMenuEl(null);
                setPwOpen(true);
              }}
            >
              <ListItemIcon>
                <KeyIcon fontSize="small" />
              </ListItemIcon>
              Change password
            </MenuItem>
            <MenuItem onClick={() => void logout().then(() => navigate('/login'))}>
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: DRAWER }, flexShrink: { md: 0 } }} aria-label="Main navigation">
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: DRAWER } }}
        >
          {drawer}
        </Drawer>
        <Drawer variant="permanent" open sx={{ display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: DRAWER } }}>
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flex: 1, minWidth: 0, px: { xs: 2, sm: 3 }, py: 3 }}>
        <Toolbar />
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </Box>

      <ChangePasswordDialog open={pwOpen || !!user?.mustChangePassword} forced={!!user?.mustChangePassword} onClose={() => setPwOpen(false)} />
    </Box>
  );
}
