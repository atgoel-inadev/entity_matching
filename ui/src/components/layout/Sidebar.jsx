import { useLocation, useNavigate } from 'react-router-dom';
import {
  Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  Toolbar, Divider, Typography, Box,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import TuneIcon from '@mui/icons-material/Tune';
import SearchIcon from '@mui/icons-material/Search';
import StorageIcon from '@mui/icons-material/Storage';

const DRAWER_WIDTH = 240;

const navItems = [
  { label: 'Dashboard', path: '/', icon: <DashboardIcon /> },
  { label: 'Profiles', path: '/profiles', icon: <TuneIcon /> },
  { label: 'Resolve', path: '/resolve', icon: <SearchIcon /> },
  { label: 'Seed Data', path: '/seed', icon: <StorageIcon /> },
];

export default function Sidebar({ open, onClose, variant = 'permanent' }) {
  const location = useLocation();
  const navigate = useNavigate();

  const isSelected = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const content = (
    <>
      <Toolbar>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SearchIcon color="primary" />
          <Typography variant="h6" color="primary" noWrap>
            ResolveIQ
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      <List>
        {navItems.map((item) => (
          <ListItemButton
            key={item.path}
            selected={isSelected(item.path)}
            onClick={() => {
              navigate(item.path);
              if (variant === 'temporary') onClose?.();
            }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
    </>
  );

  return (
    <Drawer
      variant={variant}
      open={variant === 'permanent' ? true : open}
      onClose={onClose}
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
      }}
    >
      {content}
    </Drawer>
  );
}

export { DRAWER_WIDTH };
